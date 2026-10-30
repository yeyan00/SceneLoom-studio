import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareConverter } from './prepare-converter.mjs';
const root = fileURLToPath(new URL("../", import.meta.url));
if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("This portable target currently requires Windows x64");
const env = { ...process.env };
const localCargo = path.join(root, "build/toolchains/cargo"),
  localRustup = path.join(root, "build/toolchains/rustup");
try {
  await fs.access(path.join(localCargo, "bin/cargo.exe"));
  env.CARGO_HOME = localCargo;
  env.RUSTUP_HOME = localRustup;
  env.PATH = path.join(localCargo, "bin") + path.delimiter + env.PATH;
} catch {}
function run(file, args, options = {}) {
  const r = spawnSync(file, args, {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${file} failed: ${r.status}`);
}
const version = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
).version;
const portableName = `SceneLoom-Studio-${version}-win-x64`;
const output = path.join(
  root,
  "release",
  portableName,
);
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const running = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
  `$portableRoot = '${output.replaceAll("'", "''")}\\'; Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($portableRoot, [StringComparison]::OrdinalIgnoreCase)) -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -and $_.CommandLine.Contains($portableRoot)) } | Select-Object ProcessId, Name | ConvertTo-Json -Compress`,
], { encoding: 'utf8', windowsHide: true });
if (running.error || running.status !== 0) throw new Error('Cannot verify whether the portable application is running');
if (running.stdout.trim()) throw new Error(`Portable application or its backend is running. Close it before rebuilding: ${running.stdout.trim()}`);
if (process.argv.includes('--check')) {
  console.log(`Portable output available: ${output}`);
  process.exit(0);
}
await prepareConverter();
run(process.execPath, ["node_modules/vite/bin/vite.js", "build"]);
run(process.execPath, [
  "node_modules/@tauri-apps/cli/tauri.js",
  "build",
  "--no-bundle",
]);
await fs.mkdir(output, { recursive: true });
const app = path.join(output, "app");
if (path.relative(output, path.resolve(app)) !== "app")
  throw new Error("Invalid app staging path");
await fs.rm(app, { recursive: true, force: true });
for (const directory of ["server", "shared", "dist"])
  await fs.cp(path.join(root, directory), path.join(app, directory), {
    recursive: true,
  });
await fs.mkdir(path.join(output, "runtime"), { recursive: true });
await fs.writeFile(
  path.join(app, "package.json"),
  JSON.stringify({ type: "module", private: true }),
);
await fs.copyFile(process.execPath, path.join(output, "runtime/node.exe"));
await fs.copyFile(
  path.join(root, "src-tauri/target/release/sceneloom-studio.exe"),
  path.join(output, "SceneLoom.exe"),
);
const nodeLicense = path.join(path.dirname(process.execPath), "LICENSE");
try {
  await fs.copyFile(nodeLicense, path.join(output, "runtime/NODE-LICENSE.txt"));
} catch {
  throw new Error("Node.js LICENSE not found next to node.exe");
}
await fs.cp(path.join(root, "public/licenses"), path.join(output, "licenses"), {
  recursive: true,
});
await fs.cp(
  path.join(root, "tools/PotreeConverter_2.1.5_x64_windows"),
  path.join(output, "tools/PotreeConverter"),
  { recursive: true },
);
await fs.mkdir(path.join(output, "tools/plugins"), { recursive: true });
await fs.copyFile(
  path.join(root, "docs/绿色版使用说明.txt"),
  path.join(output, "README.txt"),
);
await fs.writeFile(
  path.join(output, "build-info.json"),
  JSON.stringify(
    {
      version,
      target: "windows-x64",
      shell: "tauri",
      node: process.version,
      built: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(`Portable folder: ${output}`);
// Create an archive from program files only, never from persistent user data.
const zip = output + ".zip";
const items = [
  "SceneLoom.exe",
  "app",
  "runtime",
  "licenses",
  "tools",
  "README.txt",
  "build-info.json",
]
  .map((name) => `'${path.join(output, name).replaceAll("'", "''")}'`)
  .join(",");
run(powershell, [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  `Compress-Archive -LiteralPath ${items} -DestinationPath '${zip.replaceAll("'", "''")}' -Force`,
]);
console.log(`Portable archive: ${zip}`);
