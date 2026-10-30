import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// PotreeConverter 2.1.5 uses narrow Windows file APIs. A per-process UTF-8
// manifest fixes Unicode argv and filesystem paths without changing system ACP.
export async function prepareConverter() {
  if (process.platform !== 'win32') return;
  const root = fileURLToPath(new URL('../', import.meta.url));
  const executable = path.join(root, 'tools/PotreeConverter_2.1.5_x64_windows/PotreeConverter.exe');
  if ((await fs.readFile(executable)).includes(Buffer.from('>UTF-8</activeCodePage>'))) return;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const sdk = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows Kits\\Installed Roots').KitsRoot10"], { encoding: 'utf8', windowsHide: true });
  if (sdk.status !== 0 || !sdk.stdout.trim()) throw new Error('Windows SDK required to prepare UTF-8 PotreeConverter');
  const bin = path.join(sdk.stdout.trim(), 'bin');
  let manifestTool;
  for (const version of (await fs.readdir(bin)).sort().reverse()) {
    const candidate = path.join(bin, version, 'x64/mt.exe');
    try { await fs.access(candidate); manifestTool = candidate; break; } catch {}
  }
  if (!manifestTool) throw new Error('Windows SDK mt.exe not found');
  await fs.mkdir(path.join(root, 'build'), { recursive: true });
  const staging = await fs.mkdtemp(path.join(root, 'build/converter-manifest-'));
  try {
    const copy = path.join(staging, 'PotreeConverter.exe'), original = path.join(staging, 'original.manifest');
    await fs.copyFile(executable, copy);
    const run = args => {
      const result = spawnSync(manifestTool, args, { encoding: 'utf8', windowsHide: true });
      if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stdout + result.stderr);
    };
    run([`-inputresource:${copy};#1`, `-out:${original}`]);
    run(['-manifest', original, path.join(root, 'scripts/potree-utf8.manifest'), `-outputresource:${copy};#1`]);
    await fs.copyFile(copy, executable);
    console.log('Prepared PotreeConverter for UTF-8 Windows paths');
  } finally {
    // Only remove the exact temporary directory we created under build/.
    if (path.dirname(staging) === path.join(root, 'build')) await fs.rm(staging, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  await fs.mkdir(path.join(root, 'build'), { recursive: true });
  await prepareConverter();
}
