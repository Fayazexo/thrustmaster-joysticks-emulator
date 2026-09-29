const $ = (id) => document.getElementById(id);

const els = {
  backend: $('backend'),
  device: $('device'),
  connect: $('connect'),
  overlay: $('overlay'),
  message: $('message'),
  profileName: $('profile-name'),
  profileLoad: $('profile-load'),
  profileClear: $('profile-clear'),
  profileWarning: $('profile-warning'),
  controls: $('controls'),
  pad: $('pad'),
  knob: $('knob'),
  xVal: $('x-val'),
  yVal: $('y-val'),
  selfCentre: $('self-centre'),
  twist: $('axis-Rz'),
  twistRow: $('twist-row'),
  twistLabel: $('twist-label'),
  axes: $('axes'),
  hat: $('hat'),
  buttons: $('buttons'),
};

// vJoy axes in display order. X/Y live on the stick pad and Rz on the twist slider;
// the rest become vertical sliders. Throttle-like axes rest at 0, the others centred.
const VJOY_AXIS_ORDER = ['X', 'Y', 'Z', 'Rx', 'Ry', 'Rz', 'Slider0', 'Slider1'];
const REST_AT_ZERO = new Set(['Z', 'Slider0', 'Slider1']);

// Hat grid, row by row; null is the empty centre cell.
const HAT_CELLS = [315, 0, 45, 270, null, 90, 225, 180, 135];
const HAT_ARROWS = { 315: '↖', 0: '↑', 45: '↗', 270: '←', 90: '→', 225: '↙', 180: '↓', 135: '↘' };

let device = null; // capabilities of the acquired vJoy device
let profile = null; // the captured joystick this device stands in for
let activeTab = 'control';
const axisValues = {};

function showMessage(el, text) {
  el.textContent = text ?? '';
  el.hidden = !text;
}

function hasAxis(name) {
  return Boolean(device?.axes.some((a) => a.name === name));
}

function setAxis(name, value) {
  const v = Math.min(1, Math.max(0, value));
  if (axisValues[name] === v) return;
  axisValues[name] = v;
  if (hasAxis(name)) window.vjoy.setAxis(name, v);
}

// The real joystick's name for a vJoy axis, from the profile (e.g. Slider0 → "Slider").
function profileAxisName(vjoyAxis) {
  const field = profile?.reports?.flatMap((r) => r.fields ?? []).find((f) => f.vjoy === vjoyAxis);
  return field?.name;
}

// ---- Stick pad -------------------------------------------------------------

function setStick(x, y) {
  setAxis('X', x);
  setAxis('Y', y);
  els.knob.style.left = `${x * 100}%`;
  els.knob.style.top = `${y * 100}%`;
  els.xVal.textContent = x.toFixed(2);
  els.yVal.textContent = y.toFixed(2);
}

function padPosition(e) {
  const r = els.pad.getBoundingClientRect();
  return [
    Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  ];
}

els.pad.addEventListener('pointerdown', (e) => {
  els.pad.setPointerCapture(e.pointerId);
  setStick(...padPosition(e));
});
els.pad.addEventListener('pointermove', (e) => {
  if (els.pad.hasPointerCapture(e.pointerId)) setStick(...padPosition(e));
});
els.pad.addEventListener('pointerup', () => {
  if (els.selfCentre.checked) setStick(0.5, 0.5);
});

els.twist.addEventListener('input', () => setAxis('Rz', Number(els.twist.value)));
els.twist.addEventListener('pointerup', () => {
  if (!els.selfCentre.checked) return;
  els.twist.value = 0.5;
  setAxis('Rz', 0.5);
});

// ---- Device-dependent controls ---------------------------------------------

function buildSliders() {
  els.axes.replaceChildren();
  const present = VJOY_AXIS_ORDER.filter((a) => !['X', 'Y', 'Rz'].includes(a) && hasAxis(a));
  if (!present.length) {
    els.axes.innerHTML = '<p class="empty">No extra axes on this device.</p>';
    return;
  }
  for (const name of present) {
    const wrap = document.createElement('div');
    wrap.className = 'vslider';
    const out = document.createElement('output');
    const input = document.createElement('input');
    const rest = REST_AT_ZERO.has(name) ? 0 : 0.5;
    Object.assign(input, { type: 'range', min: 0, max: 1, step: 0.001, value: rest });
    const label = document.createElement('span');
    const real = profileAxisName(name);
    label.textContent = real ?? name;
    label.title = real ? `vJoy ${name}` : '';
    input.setAttribute('aria-label', label.textContent);
    const update = () => {
      out.textContent = Number(input.value).toFixed(2);
      setAxis(name, Number(input.value));
    };
    input.addEventListener('input', update);
    wrap.append(out, input, label);
    els.axes.append(wrap);
    update();
  }
}

function holdable(button, onPress, onRelease) {
  const up = () => {
    if (!button.classList.contains('pressed')) return;
    button.classList.remove('pressed');
    onRelease();
  };
  button.addEventListener('pointerdown', (e) => {
    button.setPointerCapture(e.pointerId);
    button.classList.add('pressed');
    onPress();
  });
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up);
}

function buildHat() {
  els.hat.replaceChildren();
  if (!device.contPovs && !device.discPovs) {
    els.hat.innerHTML = '<p class="empty">No POV hat on this device.</p>';
    return;
  }
  for (const angle of HAT_CELLS) {
    const b = document.createElement('button');
    if (angle === null) {
      b.className = 'centre';
    } else {
      b.textContent = HAT_ARROWS[angle];
      b.dataset.angle = angle;
      holdable(b, () => window.vjoy.setPov(1, angle), () => window.vjoy.setPov(1, -1));
    }
    els.hat.append(b);
  }
}

function buildButtons() {
  els.buttons.replaceChildren();
  // Show only as many buttons as the real joystick has, when we know it.
  const count = profile ? Math.min(device.buttons, profile.vjoySetup.buttons) : device.buttons;
  for (let n = 1; n <= count; n++) {
    const b = document.createElement('button');
    b.textContent = n;
    b.dataset.button = n;
    holdable(b, () => window.vjoy.setButton(n, true), () => window.vjoy.setButton(n, false));
    els.buttons.append(b);
  }
  if (!count) els.buttons.innerHTML = '<p class="empty">No buttons on this device.</p>';
}

function buildControls() {
  for (const k of Object.keys(axisValues)) delete axisValues[k];
  els.twistRow.hidden = !hasAxis('Rz');
  els.twistLabel.textContent = profileAxisName('Rz') ? `Twist (${profileAxisName('Rz')})` : 'Twist (Rz)';
  buildSliders();
  buildHat();
  buildButtons();
  setStick(0.5, 0.5);
  els.twist.value = 0.5;
  setAxis('Rz', 0.5);
}

// ---- Profile ---------------------------------------------------------------

// Explains how to change the vJoy device when it can't represent the joystick.
function checkProfile() {
  if (!profile || !device) return showMessage(els.profileWarning, null);
  const need = profile.vjoySetup;
  const problems = [];
  const missing = need.axes.filter((a) => !hasAxis(a));
  if (missing.length) problems.push(`axes ${missing.join(', ')}`);
  if (device.buttons < need.buttons) problems.push(`${need.buttons} buttons (it has ${device.buttons})`);
  if (need.contPovs > device.contPovs + device.discPovs) problems.push(`${need.contPovs} POV hat(s)`);
  else if (need.contPovs && !device.contPovs) problems.push('continuous POV hats (it has 4-direction ones)');

  if (!problems.length) return showMessage(els.profileWarning, null);
  showMessage(
    els.profileWarning,
    `vJoy device #${device.id} can't fully stand in for ${profile.device.productName}: it lacks ${problems.join('; ')}. ` +
      `Open "Configure vJoy", set device #${device.id} to axes ${need.axes.join(', ')}, ${need.buttons} buttons ` +
      `and ${need.contPovs} continuous POV, click Apply, then reconnect.`,
  );
}

function setProfile(p) {
  profile = p;
  els.profileName.textContent = p
    ? `${p.device.productName} (captured ${new Date(p.capturedAt).toLocaleDateString()})`
    : 'none';
  els.profileClear.hidden = !p;
  if (device) buildControls();
  checkProfile();
}

els.profileLoad.addEventListener('click', async () => {
  try {
    const p = await window.profiles.import();
    if (p) setProfile(p);
  } catch (err) {
    showMessage(els.profileWarning, cleanError(err));
  }
});

els.profileClear.addEventListener('click', async () => {
  await window.profiles.clear();
  setProfile(null);
});

// The Capture tab saves profiles; pick them up here.
window.addEventListener('profile-saved', (e) => setProfile(e.detail));

// ---- Keyboard --------------------------------------------------------------

const keys = new Set();
const STICK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const HAT_KEYS = { KeyI: [0, -1], KeyK: [0, 1], KeyJ: [-1, 0], KeyL: [1, 0] };

function applyKeyboardStick() {
  const dx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const dy = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
  const dz = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
  setStick(0.5 + dx * 0.5, 0.5 + dy * 0.5);
  els.twist.value = 0.5 + dz * 0.5;
  setAxis('Rz', Number(els.twist.value));
}

function applyKeyboardHat() {
  let hx = 0;
  let hy = 0;
  for (const [code, [x, y]] of Object.entries(HAT_KEYS)) {
    if (keys.has(code)) { hx += x; hy += y; }
  }
  const angle = hx || hy ? (Math.round((Math.atan2(hx, -hy) * 180) / Math.PI) + 360) % 360 : -1;
  window.vjoy.setPov(1, angle);
  for (const b of els.hat.querySelectorAll('[data-angle]')) {
    b.classList.toggle('pressed', Number(b.dataset.angle) === angle);
  }
}

function keyButton(code) {
  const m = /^Digit(\d)$/.exec(code);
  if (!m) return null;
  return m[1] === '0' ? 10 : Number(m[1]);
}

function onKey(e, down) {
  if (!device || e.repeat || e.target.tagName === 'SELECT' || activeTab !== 'control') return;
  const code = e.code;
  const button = keyButton(code);

  if (down) keys.add(code); else keys.delete(code);

  if (STICK_KEYS.includes(code)) {
    e.preventDefault();
    applyKeyboardStick();
  } else if (code in HAT_KEYS) {
    applyKeyboardHat();
  } else if (button && els.buttons.querySelector(`[data-button="${button}"]`)) {
    window.vjoy.setButton(button, down);
    els.buttons.querySelector(`[data-button="${button}"]`).classList.toggle('pressed', down);
  }
}

window.addEventListener('keydown', (e) => onKey(e, true));
window.addEventListener('keyup', (e) => onKey(e, false));
window.addEventListener('blur', () => {
  if (!keys.size) return;
  keys.clear();
  if (device) { applyKeyboardStick(); applyKeyboardHat(); }
});

// ---- Tabs and overlay ------------------------------------------------------

function showTab(name) {
  activeTab = name;
  for (const t of document.querySelectorAll('[data-tab-target]')) {
    t.setAttribute('aria-selected', String(t.dataset.tabTarget === name));
  }
  for (const panel of document.querySelectorAll('[data-tab]')) {
    panel.hidden = panel.dataset.tab !== name;
  }
}

for (const tab of document.querySelectorAll('[data-tab-target]')) {
  tab.addEventListener('click', () => showTab(tab.dataset.tabTarget));
}

function applyOverlay(on) {
  document.body.classList.toggle('overlay', on);
  els.overlay.textContent = on ? 'Exit overlay' : 'Overlay';
  if (on) showTab('control');
}

els.overlay.addEventListener('click', () => {
  window.app.setOverlay(!document.body.classList.contains('overlay'));
});
window.app.onOverlay(applyOverlay);

// ---- Connection ------------------------------------------------------------

function cleanError(err) {
  return err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

async function refreshDevices() {
  const devices = await window.vjoy.devices();
  const current = els.device.value;
  els.device.replaceChildren(
    ...devices
      .filter((d) => d.status !== 'missing')
      .map((d) => new Option(`#${d.id} (${d.status})`, d.id)),
  );
  if (current) els.device.value = current;
  return devices;
}

function setConnected(caps) {
  device = caps;
  els.controls.dataset.disabled = String(!device);
  els.device.disabled = Boolean(device) || !els.device.options.length;
  els.connect.textContent = device ? 'Disconnect' : 'Connect';
  els.connect.classList.toggle('connected', Boolean(device));
  if (device) buildControls();
  checkProfile();
}

async function connect(id) {
  showMessage(els.message, null);
  try {
    setConnected(await window.vjoy.acquire(id));
  } catch (err) {
    showMessage(els.message, cleanError(err));
  }
  await refreshDevices();
  if (device) els.device.value = device.id;
}

els.connect.addEventListener('click', async () => {
  if (device) {
    await window.vjoy.release();
    setConnected(null);
    await refreshDevices();
  } else {
    await connect(Number(els.device.value));
  }
});

async function init() {
  const [info, settings, savedProfile] = await Promise.all([
    window.vjoy.info(),
    window.app.settings(),
    window.profiles.get(),
  ]);
  setProfile(savedProfile);
  applyOverlay(Boolean(settings.overlay));

  if (!info.available) {
    els.backend.textContent = 'vJoy not available';
    showMessage(els.message, `${info.error} You can still use the Capture tab to record a joystick profile.`);
    els.connect.disabled = true;
    setConnected(null);
    return;
  }

  els.backend.textContent = `vJoy ${info.version ? `v${info.version.toString(16)}` : ''}`.trim();
  els.backend.classList.toggle('live', info.enabled);

  if (!info.enabled) {
    showMessage(els.message, 'vJoy is installed but disabled. Enable it in "Configure vJoy", then restart this app.');
  } else if (info.driverMatch === false) {
    showMessage(els.message, 'vJoyInterface.dll and the vJoy driver versions differ. Reinstall vJoy if input does not arrive.');
  }

  const devices = await refreshDevices();
  setConnected(null);
  if (!els.device.options.length) {
    showMessage(els.message, 'No vJoy devices are enabled. Open "Configure vJoy", enable device #1, click Apply, then restart this app.');
    els.connect.disabled = true;
    return;
  }

  // Reconnect to the device used last time, so launching the app is all it takes.
  const last = devices.find((d) => d.id === settings.deviceId);
  if (last && (last.status === 'free' || last.status === 'owned')) await connect(last.id);
}

init();
