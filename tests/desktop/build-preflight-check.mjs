import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const root = path.resolve(import.meta.dirname, '../..');
const env = { ...process.env, SCENELOOM_PORTABLE_NAME: 'should-not-create-another-version' };
const check = () => spawnSync(process.execPath, ['scripts/build-portable.mjs', '--check'], {
  cwd: root, env, encoding: 'utf8', windowsHide: true,
});
const initial = check();
assert.equal(initial.status, 0, initial.stderr);
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const output = path.join(root, 'release', `SceneLoom-Studio-${version}-win-x64`);
assert.ok(initial.stdout.includes(output));
assert.ok(!initial.stdout.includes(env.SCENELOOM_PORTABLE_NAME));
// An orphaned bundled backend must block packaging even without a GUI process.
const backend = spawn(path.join(output, 'runtime/node.exe'), ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'], {
  cwd: output, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
});
try {
  await new Promise((resolve, reject) => { backend.stdout.once('data', resolve); backend.once('error', reject); backend.once('exit', () => reject(new Error('Test backend exited before readiness'))); });
  const blocked = check();
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /backend is running/);
  assert.ok(!blocked.stdout.includes('vite'), 'Build started before the process check');
} finally {
  const exited = new Promise(resolve => backend.once('exit', resolve));
  backend.kill();
  await exited;
}
assert.equal(check().status, 0, 'Backend still blocks packaging after exit');
console.log('Passed: fixed output; running backend blocks before build; exit releases output.');
