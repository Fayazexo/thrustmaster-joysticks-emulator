// Small JSON files in the app's user-data folder: settings and the active profile.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

function file(name) {
  return path.join(app.getPath('userData'), name);
}

function read(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function write(name, value) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify(value, null, 2));
}

function remove(name) {
  fs.rmSync(file(name), { force: true });
}

const PROFILE_FORMAT = 'joystick-emulator-profile/1';

// Checks a profile's shape before it's stored or used; throws on anything unexpected.
function validateProfile(p) {
  const ok =
    p && p.format === PROFILE_FORMAT &&
    p.device && typeof p.device.productName === 'string' &&
    p.vjoySetup && Array.isArray(p.vjoySetup.axes) &&
    p.vjoySetup.axes.every((a) => typeof a === 'string') &&
    Number.isInteger(p.vjoySetup.buttons) && Number.isInteger(p.vjoySetup.contPovs) &&
    Array.isArray(p.reports);
  if (!ok) throw new Error('This file is not a Joystick Emulator profile.');
  return p;
}

module.exports = {
  settings: {
    get: () => read('settings.json', {}),
    update: (patch) => {
      const next = { ...read('settings.json', {}), ...patch };
      write('settings.json', next);
      return next;
    },
  },
  profile: {
    get: () => read('profile.json', null),
    set: (p) => write('profile.json', validateProfile(p)),
    clear: () => remove('profile.json'),
  },
  validateProfile,
};
