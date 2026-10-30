param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class ManifestResource {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr LoadLibraryEx(string p, IntPtr f, uint flags);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr FindResource(IntPtr m, IntPtr name, IntPtr type);
  [DllImport("kernel32.dll")] static extern uint SizeofResource(IntPtr m, IntPtr r);
  [DllImport("kernel32.dll")] static extern IntPtr LoadResource(IntPtr m, IntPtr r);
  [DllImport("kernel32.dll")] static extern IntPtr LockResource(IntPtr r);
  [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr m);
  delegate bool LanguageCallback(IntPtr m, IntPtr t, IntPtr n, ushort lang, IntPtr param);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool EnumResourceLanguages(IntPtr m, IntPtr t, IntPtr n, LanguageCallback cb, IntPtr param);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr BeginUpdateResource(string p, bool delete);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateResource(IntPtr h, IntPtr t, IntPtr n, ushort lang, byte[] data, uint len);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool EndUpdateResource(IntPtr h, bool discard);
  public static ushort Language;
  public static string Read(string p) {
    var m=LoadLibraryEx(p,IntPtr.Zero,2); if(m==IntPtr.Zero)throw new Win32Exception();
    try {
      var r=FindResource(m,(IntPtr)1,(IntPtr)24);
      if(r==IntPtr.Zero)throw new Win32Exception();
      LanguageCallback cb=(a,b,c,l,d)=>{Language=l;return true;};
      if(!EnumResourceLanguages(m,(IntPtr)24,(IntPtr)1,cb,IntPtr.Zero))throw new Win32Exception();
      var bytes=new byte[SizeofResource(m,r)];
      Marshal.Copy(LockResource(LoadResource(m,r)),bytes,0,bytes.Length);
      return System.Text.Encoding.UTF8.GetString(bytes).TrimEnd('\0');
    } finally {FreeLibrary(m);}
  }
  public static void Write(string p,string xml) {
    var h=BeginUpdateResource(p,false);if(h==IntPtr.Zero)throw new Win32Exception();
    bool committed=false;
    try {
      var bytes=new System.Text.UTF8Encoding(false).GetBytes(xml);
      if(!UpdateResource(h,(IntPtr)24,(IntPtr)1,Language,bytes,(uint)bytes.Length))throw new Win32Exception();
      if(!EndUpdateResource(h,false))throw new Win32Exception();
      committed=true;
    }finally{if(!committed)EndUpdateResource(h,true);}
  }
}
'@
$Executable = (Resolve-Path -LiteralPath $Executable).Path
$original = [ManifestResource]::Read($Executable)
$xml = New-Object System.Xml.XmlDocument
$xml.LoadXml($original)
$ns = 'urn:schemas-microsoft-com:asm.v3'
$application = $xml.DocumentElement.SelectSingleNode("*[local-name()='application' and namespace-uri()='$ns']")
if (!$application) { $application = $xml.CreateElement('application', $ns); [void]$xml.DocumentElement.AppendChild($application) }
$settings = $application.SelectSingleNode("*[local-name()='windowsSettings']")
if (!$settings) { $settings = $xml.CreateElement('windowsSettings', $ns); [void]$application.AppendChild($settings) }
$codePageNs = 'http://schemas.microsoft.com/SMI/2019/WindowsSettings'
$codePage = $settings.SelectSingleNode("*[local-name()='activeCodePage' and namespace-uri()='$codePageNs']")
if (!$codePage) { $codePage = $xml.CreateElement('activeCodePage', $codePageNs); [void]$settings.AppendChild($codePage) }
$codePage.InnerText = 'UTF-8'
[ManifestResource]::Write($Executable,$xml.OuterXml)
$after = [ManifestResource]::Read($Executable)
@{original=$original;patched=$after;language=[ManifestResource]::Language;executable=$Executable} | ConvertTo-Json -Compress
