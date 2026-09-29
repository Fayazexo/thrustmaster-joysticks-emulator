// Koffi ships its native code in per-platform packages, and npm only installs the one
// for the current OS. To build the Windows app from macOS/Linux, fetch the Windows
// package next to it. On Windows it's already there and this does nothing.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const target = path.join(root, 'node_modules', '@koromix', 'koffi-win32-x64');
const { version } = require(path.join(root, 'node_modules', 'koffi', 'package.json'));

const installed = fs.existsSync(path.join(target, 'package.json')) &&
  require(path.join(target, 'package.json')).version === version;
if (installed) process.exit(0);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koffi-win-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tarball = execFileSync(npm, ['pack', `@koromix/koffi-win32-x64@${version}`, '--silent'], {
  cwd: tmp,
  encoding: 'utf8',
  shell: process.platform === 'win32',
}).trim().split('\n').pop();

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
execFileSync('tar', ['-xzf', path.join(tmp, tarball), '-C', target, '--strip-components=1']);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Fetched @koromix/koffi-win32-x64@${version}`);
