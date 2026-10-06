// The name Windows reports for vJoy devices to games (DirectInput / joy.cpl) comes
// from the per-user OEM registry entry for vJoy's USB IDs. Changing it lets the
// virtual joystick appear under the real joystick's name. The USB IDs stay 1234:BEAD.
const { execFile } = require('node:child_process');

const OEM_KEY = 'HKCU\\System\\CurrentControlSet\\Control\\MediaProperties\\PrivateProperties\\Joystick\\OEM\\VID_1234&PID_BEAD';
const VJOY_DEFAULT = 'vJoy Device';

// Plain printable names only; keeps reg.exe argument handling predictable.
const NAME_PATTERN = /^[A-Za-z0-9 ._\-()+#/&,]{1,64}$/;

function reg(args) {
  return new Promise((resolve, reject) => {
    execFile('reg', args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout);
    });
  });
}

async function getName() {
  try {
    const out = await reg(['query', OEM_KEY, '/v', 'OEMName']);
    const m = /OEMName\s+REG_SZ\s+(.*)/.exec(out);
    return m ? m[1].trim() : null;
  } catch {
    return null; // key or value doesn't exist yet
  }
}

async function setName(name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name.trim())) {
    throw new Error('Use 1–64 letters, numbers, spaces or . _ - ( ) + # / & ,');
  }
  await reg(['add', OEM_KEY, '/v', 'OEMName', '/t', 'REG_SZ', '/d', name.trim(), '/f']);
  return getName();
}

async function clearName() {
  try {
    await reg(['delete', OEM_KEY, '/v', 'OEMName', '/f']);
  } catch {
    // already absent
  }
  return getName();
}

module.exports = { getName, setName, clearName, VJOY_DEFAULT };
