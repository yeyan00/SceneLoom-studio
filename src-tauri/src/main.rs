#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, io::{BufRead, BufReader, Write}, net::TcpStream, path::PathBuf, process::{Child, Command, Stdio}, sync::{mpsc, Mutex}, time::{Duration, Instant}};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

struct Backend { child: Child, port: u16, token: String, _job: std::os::windows::io::OwnedHandle }
impl Drop for Backend {
    fn drop(&mut self) {
        if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", self.port)) {
            let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
            let _ = write!(stream,"POST /api/desktop/shutdown HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}",self.port,self.token);
        }
        let deadline=Instant::now()+Duration::from_secs(3);
        while Instant::now()<deadline { if matches!(self.child.try_wait(),Ok(Some(_))) { return; } std::thread::sleep(Duration::from_millis(30)); }
        let _=self.child.kill(); let _=self.child.wait();
    }
}

fn spawn_backend(base: &PathBuf) -> Result<Backend, Box<dyn std::error::Error>> {
    use std::os::windows::{io::{AsRawHandle, FromRawHandle, OwnedHandle},process::CommandExt};
    use windows_sys::Win32::System::JobObjects::*;
    let data=base.join("data");fs::create_dir_all(data.join("logs"))?;
    let token=uuid::Uuid::new_v4().simple().to_string();
    let mut child=Command::new(base.join("runtime/node.exe"))
        .arg(base.join("app/server/index.mjs")).arg("--production").current_dir(base.join("app"))
        .env("PORT","0").env("SCENELOOM_HOME",&data).env("SCENELOOM_DESKTOP_TOKEN",&token)
        .env("SCENELOOM_TOOLS",base.join("tools/plugins"))
        .env("POTREE_CONVERTER",base.join("tools/PotreeConverter/PotreeConverter.exe"))
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::from(fs::File::create(data.join("logs/backend.stderr.log"))?))
        .creation_flags(0x08000000).spawn()?;
    let job = unsafe {
        let handle=CreateJobObjectW(std::ptr::null(),std::ptr::null());
        if handle.is_null() {let _=child.kill();return Err(std::io::Error::last_os_error().into());}
        let owned=OwnedHandle::from_raw_handle(handle);
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION=std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(handle,JobObjectExtendedLimitInformation,&info as *const _ as *const _,std::mem::size_of_val(&info) as u32)==0 || AssignProcessToJobObject(handle,child.as_raw_handle())==0 {let _=child.kill();return Err(std::io::Error::last_os_error().into());}
        owned
    };
    let output=child.stdout.take().ok_or("Backend stdout unavailable")?;
    let (send,recv)=mpsc::channel();
    std::thread::spawn(move|| { for line in BufReader::new(output).lines().map_while(Result::ok) { if let Some(url)=line.strip_prefix("SceneLoom http://127.0.0.1:") {let _=send.send(url.parse::<u16>());} } });
    let port=match recv.recv_timeout(Duration::from_secs(30)) { Ok(Ok(port))=>port, _=>{let _=child.kill();return Err("Local service failed to start. See data/logs/backend.stderr.log".into());} };
    Ok(Backend{child,port,token,_job:job})
}

fn main() {
    let app=tauri::Builder::default().plugin(tauri_plugin_dialog::init()).setup(|app| {
        let base=std::env::current_exe()?.parent().ok_or("Application directory unavailable")?.to_path_buf();
        let backend=match spawn_backend(&base) {Ok(backend)=>backend,Err(error)=>{app.dialog().message(error.to_string()).title("SceneLoom startup failed").blocking_show();return Err(error);}};
        let url=format!("http://127.0.0.1:{}/?desktop_token={}",backend.port,backend.token).parse()?;
        let allowed_origin=format!("http://127.0.0.1:{}",backend.port);
        let mut builder=WebviewWindowBuilder::new(app,"main",WebviewUrl::External(url)).title("SceneLoom Studio").inner_size(1440.0,960.0).min_inner_size(800.0,600.0)
            .data_directory(base.join("data/webview2"))
            .on_navigation(move |url| url.origin().ascii_serialization()==allowed_origin);
        let args:Vec<String>=std::env::args().collect();
        if let Some(i)=args.iter().position(|a|a=="--test-cdp-port") { if let Some(port)=args.get(i+1).and_then(|v|v.parse::<u16>().ok()) {builder=builder.additional_browser_args(&format!("--remote-debugging-port={port}"));} }
        builder.build()?;
        app.manage(Mutex::new(Some(backend)));
        Ok(())
    }).build(tauri::generate_context!()).expect("Failed to initialize SceneLoom desktop");
    app.run(|handle,event| { if matches!(event,tauri::RunEvent::Exit) { if let Some(state)=handle.try_state::<Mutex<Option<Backend>>>() {state.lock().unwrap().take();} } });
}
