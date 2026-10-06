const $ = (id) => document.getElementById(id);

document.body.classList.toggle('mac', navigator.userAgent.includes('Macintosh'));
const IS_WINDOWS = navigator.userAgent.includes('Windows');
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');

const els = {
  controlView: document.querySelector('[data-view="control"]'),
  stLinkBox: $('st-link-box'),
  stLink: $('st-link'),
  stDevice: $('st-device'),
  stProfile: $('st-profile'),
  stTx: $('st-tx'),
  overlay: $('overlay'),
  selfCentre: $('self-centre'),
  centre: $('centre'),
  fieldWrap: $('field-wrap'),
  field: $('field'),
  canvas: $('field-canvas'),
  preflight: $('preflight'),
  preflightTitle: $('preflight-title'),
  steps: $('steps'),
  preflightConnect: $('preflight-connect'),
  preflightRecheck: $('preflight-recheck'),
  xVal: $('x-val'),
  yVal: $('y-val'),
  rzVal: $('rz-val'),
  rzReadout: $('rz-readout'),
  device: $('device'),
  connect: $('connect'),
  linkState: $('link-state'),
  stageState: $('stage-state'),
  trace: $('trace'),
  message: $('message'),
  profileName: $('profile-name'),
  profileNote: $('profile-note'),
  profileLoad: $('profile-load'),
  profileClear: $('profile-clear'),
  profileWarning: $('profile-warning'),
  axes: $('axes'),
  hat: $('hat'),
  buttons: $('buttons'),
};

// vJoy axes in display order. X/Y are the stick field; the rest become sliders.
// Throttle-like axes rest at 0; the others are centred.
const VJOY_AXIS_ORDER = ['Rz', 'Z', 'Rx', 'Ry', 'Slider0', 'Slider1'];
const CENTRED = new Set(['Rz', 'Rx', 'Ry']);

// Hat grid, row by row; null is the empty centre cell.
const HAT_CELLS = [315, 0, 45, 270, null, 90, 225, 180, 135];
const HAT_ARROWS = { 315: '↖', 0: '↑', 45: '↗', 270: '←', 90: '→', 225: '↙', 180: '↓', 135: '↘' };

let info = null; // what the main process knows about vJoy
let devices = []; // vJoy device slots and their status
let device = null; // capabilities of the acquired vJoy device
let profile = null; // the captured joystick this device stands in for
let activeTab = 'control';

// ---- Output (counted, so the title bar can show what's being sent) ----------

let txCount = 0;
const axisValues = {};

const out = {
  axis(name, value) {
    const v = Math.min(1, Math.max(0, value));
    if (axisValues[name] === v) return;
    axisValues[name] = v;
    if (!hasAxis(name)) return;
    txCount++;
    window.vjoy.setAxis(name, v);
  },
  button(n, pressed) {
    if (!device) return;
    txCount++;
    window.vjoy.setButton(n, pressed);
  },
  pov(n, angle) {
    if (!device) return;
    txCount++;
    window.vjoy.setPov(n, angle);
  },
};

setInterval(() => {
  els.stTx.textContent = `${String(Math.min(txCount, 999)).padStart(3, '0')}/s`;
  txCount = 0;
}, 1000);

function hasAxis(name) {
  return Boolean(device?.axes.some((a) => a.name === name));
}

// The real joystick's name for a vJoy axis, from the profile (e.g. Slider0 → "Slider").
function profileAxisName(vjoyAxis) {
  const field = profile?.reports?.flatMap((r) => r.fields ?? []).find((f) => f.vjoy === vjoyAxis);
  return field?.name;
}

function signed(v) {
  const s = v * 2 - 1;
  return `${s < 0 ? '-' : '+'}${Math.abs(s).toFixed(3)}`;
}

function showAlert(el, title, body) {
  el.hidden = !title;
  if (!title) return;
  el.replaceChildren();
  const b = document.createElement('b');
  b.textContent = title;
  el.append(b);
  if (Array.isArray(body)) {
    const ol = document.createElement('ol');
    for (const line of body) {
      const li = document.createElement('li');
      li.textContent = line;
      ol.append(li);
    }
    el.append(ol);
  } else if (body) {
    el.append(document.createTextNode(body));
  }
}

function cleanError(err) {
  return err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function flash() {
  if (REDUCED_MOTION.matches) return;
  document.body.classList.add('flash');
  setTimeout(() => document.body.classList.remove('flash'), 70);
}

// ---- Stick field -------------------------------------------------------------

const stick = { x: 0.5, y: 0.5, trail: [] };
const TRAIL_MS = 1400;

// A fixed, seeded set of vertical bars. Bars near the stick's X position are drawn,
// so the field visibly gathers around the signal.
const BARS = (() => {
  let seed = 819271;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 220 }, () => ({ pos: rand(), w: rand() < 0.75 ? 1 : rand() < 0.7 ? 2 : 3, gate: rand() }));
})();
const EDGE = Array.from({ length: 120 }, (_, i) => ({ pos: i / 120 + BARS[i].gate / 240, w: BARS[i].w }));

const ctx = els.canvas.getContext('2d');
let drawQueued = false;

function sizeCanvas() {
  const r = els.field.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  els.canvas.width = Math.round(r.width * dpr);
  els.canvas.height = Math.round(r.height * dpr);
  requestDraw();
}

function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(draw);
}

function draw(now) {
  drawQueued = false;
  const dpr = window.devicePixelRatio || 1;
  const W = els.canvas.width;
  const H = els.canvas.height;
  const px = (v) => Math.round(v * dpr);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';

  // Edge strips: a barcode ruler along the top and bottom.
  const strip = px(10);
  for (const b of EDGE) {
    const x = Math.round(b.pos * W);
    ctx.fillRect(x, 0, px(b.w), strip);
    ctx.fillRect(x, H - strip, px(b.w), strip);
  }

  // Signal bars gather around X; their reach shrinks as Y moves away from centre.
  const live = Boolean(device);
  const spread = 0.05 + 0.13 * (1 - Math.abs(stick.y - 0.5) * 2);
  for (const b of BARS) {
    const d = (b.pos - stick.x) / spread;
    const density = Math.exp(-d * d);
    if (b.gate > density * (live ? 1 : 0.45)) continue;
    ctx.fillRect(Math.round(b.pos * W), strip + px(6), px(b.w), H - 2 * strip - px(12));
  }

  // Centre cross and 10% ticks.
  const cx = W / 2;
  const cy = H / 2;
  ctx.fillRect(cx - px(8), cy, px(17), px(1));
  ctx.fillRect(cx, cy - px(8), px(1), px(17));
  for (let i = 1; i < 10; i++) {
    ctx.fillRect(px(0), Math.round((H * i) / 10), px(i === 5 ? 10 : 5), px(1));
    ctx.fillRect(W - px(i === 5 ? 10 : 5), Math.round((H * i) / 10), px(i === 5 ? 10 : 5), px(1));
  }

  // Scale numerals along the left edge: -1.0 at the top to +1.0 at the bottom.
  ctx.font = `${px(11)}px 'Departure Mono', monospace`;
  ctx.textBaseline = 'middle';
  for (const [at, label] of [[0.06, '-1.0'], [0.25, '-0.5'], [0.75, '+0.5'], [0.94, '+1.0']]) {
    ctx.fillText(label, px(14), Math.round(H * at));
  }

  // Horizontal trace at Y.
  const ky = Math.round(stick.y * H);
  const kx = Math.round(stick.x * W);
  ctx.fillRect(0, ky, W, px(1));

  // Recent motion as a trail of points.
  const t = now ?? performance.now();
  stick.trail = stick.trail.filter((p) => t - p.t < TRAIL_MS);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = px(1);
  ctx.beginPath();
  stick.trail.forEach((p, i) => {
    const x = p.x * W;
    const y = p.y * H;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.stroke();

  // Knob: a solid square with a cut-in target.
  const k = px(26);
  ctx.fillRect(kx - k / 2, ky - k / 2, k, k);
  ctx.fillStyle = '#000';
  ctx.fillRect(kx - k / 2 + px(5), ky - k / 2 + px(5), k - px(10), k - px(10));
  ctx.fillStyle = '#fff';
  ctx.fillRect(kx - px(2), ky - px(2), px(4), px(4));

  if (stick.trail.length) requestDraw();
}

function setStick(x, y) {
  stick.x = Math.min(1, Math.max(0, x));
  stick.y = Math.min(1, Math.max(0, y));
  stick.trail.push({ x: stick.x, y: stick.y, t: performance.now() });
  out.axis('X', stick.x);
  out.axis('Y', stick.y);
  els.xVal.textContent = signed(stick.x);
  els.yVal.textContent = signed(stick.y);
  els.field.setAttribute('aria-valuetext', `X ${signed(stick.x)}, Y ${signed(stick.y)}`);
  requestDraw();
}

// Absolute drag by default; Shift switches to fine, relative movement.
let drag = null;

function fieldPoint(e) {
  const r = els.field.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, w: r.width, h: r.height };
}

els.field.addEventListener('pointerdown', (e) => {
  if (!device || e.button !== 0 || e.target.closest('.preflight')) return;
  els.field.setPointerCapture(e.pointerId);
  els.field.focus({ preventScroll: true });
  const p = fieldPoint(e);
  drag = { startX: stick.x, startY: stick.y, px: p.x, py: p.y };
  if (!e.shiftKey) setStick(p.x, p.y);
});

els.field.addEventListener('pointermove', (e) => {
  if (!drag || !els.field.hasPointerCapture(e.pointerId)) return;
  const p = fieldPoint(e);
  if (e.shiftKey) {
    setStick(drag.startX + (p.x - drag.px) * 0.25, drag.startY + (p.y - drag.py) * 0.25);
  } else {
    setStick(p.x, p.y);
    drag = { startX: stick.x, startY: stick.y, px: p.x, py: p.y };
  }
});

function endDrag() {
  if (!drag) return;
  drag = null;
  if (selfCentre()) setStick(0.5, 0.5);
}
els.field.addEventListener('pointerup', endDrag);
els.field.addEventListener('pointercancel', endDrag);
els.field.addEventListener('dblclick', () => device && setStick(0.5, 0.5));

els.field.addEventListener('keydown', (e) => {
  if (!device || e.target !== els.field) return;
  const step = e.shiftKey ? 0.005 : 0.02;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (moves[e.key]) {
    e.preventDefault();
    setStick(stick.x + moves[e.key][0], stick.y + moves[e.key][1]);
  } else if (e.key === 'Home') {
    e.preventDefault();
    setStick(0.5, 0.5);
  }
});

new ResizeObserver(() => {
  const r = els.fieldWrap.getBoundingClientRect();
  const size = Math.max(160, Math.min(r.width, r.height) - 40);
  els.field.style.setProperty('--field-size', `${size}px`);
  sizeCanvas();
}).observe(els.fieldWrap);

// ---- History trace: X and Y over the last few seconds, drawn as two signals ---------

const HISTORY_MS = 6000;
const history = [];
const traceCtx = els.trace.getContext('2d');

setInterval(() => {
  const t = performance.now();
  history.push({ t, x: stick.x, y: stick.y });
  while (history.length && t - history[0].t > HISTORY_MS) history.shift();
  drawTrace(t);
}, 50);

function drawTrace(t) {
  const c = els.trace;
  const r = c.getBoundingClientRect();
  if (!r.width) return;
  const dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
  const W = c.width;
  const H = c.height;
  traceCtx.fillStyle = '#000';
  traceCtx.fillRect(0, 0, W, H);
  traceCtx.fillStyle = '#fff';
  for (let i = 0; i < 60; i++) traceCtx.fillRect(Math.round((i / 60) * W), H - Math.round(4 * dpr), Math.max(1, Math.round(dpr)), Math.round(4 * dpr));
  const line = (key, dash) => {
    traceCtx.setLineDash(dash.map((d) => d * dpr));
    traceCtx.strokeStyle = '#fff';
    traceCtx.lineWidth = dpr;
    traceCtx.beginPath();
    history.forEach((p, i) => {
      const x = W - ((t - p.t) / HISTORY_MS) * W;
      const y = (H - 8 * dpr) * p[key] + 2 * dpr;
      if (i) traceCtx.lineTo(x, y); else traceCtx.moveTo(x, y);
    });
    traceCtx.stroke();
  };
  line('x', []);
  line('y', [3, 3]);
  traceCtx.setLineDash([]);
}

// ---- Self-centre and centre ----------------------------------------------------

function selfCentre() {
  return els.selfCentre.getAttribute('aria-checked') === 'true';
}

function toggleSwitch(el, on = el.getAttribute('aria-checked') !== 'true') {
  el.setAttribute('aria-checked', String(on));
}

els.selfCentre.addEventListener('click', () => toggleSwitch(els.selfCentre));

els.centre.addEventListener('click', () => {
  setStick(0.5, 0.5);
  sliders.Rz?.set(0.5);
});

// ---- Sliders -------------------------------------------------------------------

const sliders = {};

function makeSlider({ axis, label, sub, rest, centred }) {
  const wrap = document.createElement('div');
  wrap.className = 'slider';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = label;
  if (sub) {
    const s = document.createElement('small');
    s.textContent = sub;
    name.append(s);
  }
  const output = document.createElement('output');
  output.className = 'out';
  const track = document.createElement('div');
  track.className = 'track';
  track.tabIndex = 0;
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', label);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.innerHTML = `<div class="fill"></div>${centred ? '<div class="mid"></div>' : ''}<div class="thumb"></div>`;
  wrap.append(name, output, track);

  let value = rest;
  const format = (v) => (centred ? signed(v) : `${String(Math.round(v * 100)).padStart(3, ' ')}%`);

  function set(v) {
    value = Math.min(1, Math.max(0, v));
    const lo = centred ? Math.min(value, 0.5) : 0;
    track.style.setProperty('--v', value);
    track.style.setProperty('--lo', lo);
    track.style.setProperty('--w', centred ? Math.abs(value - 0.5) : value);
    track.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    track.setAttribute('aria-valuetext', format(value));
    output.textContent = format(value);
    out.axis(axis, value);
    if (axis === 'Rz') els.rzVal.textContent = signed(value);
  }

  const fromPointer = (e) => {
    const r = track.getBoundingClientRect();
    return (e.clientX - r.left - 6) / (r.width - 12);
  };
  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    track.setPointerCapture(e.pointerId);
    set(fromPointer(e));
  });
  track.addEventListener('pointermove', (e) => {
    if (track.hasPointerCapture(e.pointerId)) set(fromPointer(e));
  });
  const release = () => {
    if (centred && axis === 'Rz' && selfCentre()) set(0.5);
  };
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);
  track.addEventListener('keydown', (e) => {
    const small = e.shiftKey ? 0.1 : 0.01;
    const keys = {
      ArrowLeft: value - small, ArrowDown: value - small, ArrowRight: value + small, ArrowUp: value + small,
      PageDown: value - 0.1, PageUp: value + 0.1, Home: 0, End: 1,
    };
    if (e.key in keys) {
      e.preventDefault();
      e.stopPropagation();
      set(keys[e.key]);
    }
  });
  track.addEventListener('keyup', (e) => {
    if (e.key.startsWith('Arrow')) release();
  });

  set(rest);
  return { el: wrap, set, get: () => value };
}

function buildSliders() {
  els.axes.replaceChildren();
  for (const k of Object.keys(sliders)) delete sliders[k];
  const present = VJOY_AXIS_ORDER.filter((a) => hasAxis(a));
  if (!present.length) {
    els.axes.innerHTML = device
      ? '<p class="empty">This vJoy device has no axes besides X and Y.</p>'
      : '<p class="empty">Twist and throttle appear here once a vJoy device is connected.</p>';
    return;
  }
  els.axes.style.display = 'grid';
  els.axes.style.gap = '18px';
  for (const axis of present) {
    const real = profileAxisName(axis);
    const conf = vjoyConfName(axis);
    const label = axis === 'Rz' ? 'Twist' : real ?? conf;
    const sub = label.toLowerCase() === conf.toLowerCase() ? null : `· ${conf}`;
    const s = makeSlider({ axis, label, sub, rest: CENTRED.has(axis) ? 0.5 : 0, centred: CENTRED.has(axis) });
    sliders[axis] = s;
    els.axes.append(s.el);
  }
}

// ---- Hat and buttons -----------------------------------------------------------

// Hold to press; right-click (or Shift+Enter) latches it on until released the same way.
function pressable(btn, onPress, onRelease) {
  let held = false;
  let latched = false;
  const press = () => {
    btn.classList.add('pressed');
    if (!held && !latched) onPress();
    held = true;
  };
  const release = () => {
    if (!held) return;
    held = false;
    btn.classList.remove('pressed');
    if (!latched) onRelease();
  };
  const toggleLatch = () => {
    latched = !latched;
    btn.classList.toggle('latched', latched);
    btn.setAttribute('aria-pressed', String(latched));
    if (latched && !held) onPress();
    if (!latched && !held) onRelease();
  };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    btn.setPointerCapture(e.pointerId);
    press();
  });
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    toggleLatch();
  });
  btn.addEventListener('dblclick', toggleLatch);
  btn.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      if (e.shiftKey) toggleLatch(); else press();
    }
  });
  btn.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') release();
  });
  btn.setAttribute('aria-pressed', 'false');
  return {
    unlatch() { if (latched) toggleLatch(); },
    press,
    release,
  };
}

const hatCells = {};

function buildHat() {
  els.hat.replaceChildren();
  for (const k of Object.keys(hatCells)) delete hatCells[k];
  const hasHat = !device || device.contPovs || device.discPovs;
  els.hat.hidden = !hasHat;
  els.hat.parentElement.classList.toggle('no-hat', !hasHat);
  if (!hasHat) return;
  for (const angle of HAT_CELLS) {
    const b = document.createElement('button');
    if (angle === null) {
      b.className = 'centre';
      b.tabIndex = -1;
      b.setAttribute('aria-hidden', 'true');
    } else {
      b.textContent = HAT_ARROWS[angle];
      b.setAttribute('aria-label', `Hat ${angle}°`);
      hatCells[angle] = pressable(
        b,
        () => {
          for (const [a, c] of Object.entries(hatCells)) if (Number(a) !== angle) c.unlatch();
          out.pov(1, angle);
        },
        () => out.pov(1, -1),
      );
    }
    els.hat.append(b);
  }
}

const buttonCells = {};

function buildButtons() {
  els.buttons.replaceChildren();
  for (const k of Object.keys(buttonCells)) delete buttonCells[k];
  // Show only as many buttons as the real joystick has, when we know it.
  const count = device ? (profile ? Math.min(device.buttons, profile.vjoySetup.buttons) : device.buttons) : 16;
  for (let n = 1; n <= count; n++) {
    const b = document.createElement('button');
    b.textContent = String(n).padStart(2, '0');
    b.setAttribute('aria-label', `Button ${n}`);
    buttonCells[n] = pressable(b, () => out.button(n, true), () => out.button(n, false));
    els.buttons.append(b);
  }
  if (!count) els.buttons.innerHTML = '<p class="empty">No buttons on this device.</p>';
}

function buildControls() {
  for (const k of Object.keys(axisValues)) delete axisValues[k];
  els.rzReadout.hidden = Boolean(device) && !hasAxis('Rz');
  buildSliders();
  buildHat();
  buildButtons();
  stick.trail = [];
  setStick(0.5, 0.5);
}

// ---- Keyboard (only while this window is focused) -------------------------------

const keys = new Set();
const STICK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'];
const HAT_KEYS = { KeyI: [0, -1], KeyK: [0, 1], KeyJ: [-1, 0], KeyL: [1, 0] };

// Held keys deflect fully; on release an axis returns to centre only with self-centre on.
function applyKeyboardStick(code) {
  if (['KeyQ', 'KeyE'].includes(code)) {
    const dz = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
    if (dz || selfCentre()) sliders.Rz?.set(0.5 + dz * 0.5);
    return;
  }
  const dx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const dy = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0);
  if (!dx && !dy && !selfCentre()) return;
  setStick(dx || selfCentre() ? 0.5 + dx * 0.5 : stick.x, dy || selfCentre() ? 0.5 + dy * 0.5 : stick.y);
}

function applyKeyboardHat() {
  let hx = 0;
  let hy = 0;
  for (const [code, [x, y]] of Object.entries(HAT_KEYS)) {
    if (keys.has(code)) { hx += x; hy += y; }
  }
  const angle = hx || hy ? (Math.round((Math.atan2(hx, -hy) * 180) / Math.PI) + 360) % 360 : -1;
  out.pov(1, angle);
}

function keyButton(code) {
  const m = /^Digit(\d)$/.exec(code);
  if (!m) return null;
  return m[1] === '0' ? 10 : Number(m[1]);
}

function onKey(e, down) {
  if (!device || e.repeat || activeTab !== 'control') return;
  if (e.target.closest?.('select, .track, .cells button, .hat button')) return;
  const code = e.code;
  const button = keyButton(code);
  if (down) keys.add(code); else keys.delete(code);

  if (STICK_KEYS.includes(code)) {
    e.preventDefault();
    applyKeyboardStick(code);
  } else if (code in HAT_KEYS) {
    applyKeyboardHat();
  } else if (button && buttonCells[button]) {
    const cell = buttonCells[button];
    if (down) cell.press(); else cell.release();
  }
}

window.addEventListener('keydown', (e) => onKey(e, true));
window.addEventListener('keyup', (e) => onKey(e, false));
window.addEventListener('blur', () => {
  if (!keys.size) return;
  keys.clear();
  if (device) { applyKeyboardStick('KeyW'); applyKeyboardStick('KeyQ'); applyKeyboardHat(); }
});

// ---- Profile ---------------------------------------------------------------------

// Explains how to change the vJoy device when it can't represent the joystick.
function checkProfile() {
  if (!profile || !device) return showAlert(els.profileWarning, null);
  const need = profile.vjoySetup;
  const problems = [];
  const missing = need.axes.filter((a) => !hasAxis(a));
  if (missing.length) problems.push(`axes ${missing.join(', ')}`);
  if (device.buttons < need.buttons) problems.push(`${need.buttons} buttons (it has ${device.buttons})`);
  if (need.contPovs > device.contPovs + device.discPovs) problems.push(`${need.contPovs} POV hat`);
  else if (need.contPovs && !device.contPovs) problems.push('continuous POV (it has 4-direction)');
  if (!problems.length) return showAlert(els.profileWarning, null);

  showAlert(els.profileWarning, `vJoy device ${device.id} is missing ${problems.join(', ')}`, [
    'Click Disconnect, then open Configure vJoy.',
    `Select tab ${device.id}. Tick axes ${need.axes.map(vjoyConfName).join(', ')}.`,
    `Set Number of Buttons to ${need.buttons}; POVs: Continuous, ${need.contPovs}.`,
    'Click Apply, then Connect here again.',
  ]);
}

// Names as they appear in Configure vJoy.
function vjoyConfName(axis) {
  return { Slider0: 'Slider', Slider1: 'Dial/Slider2' }[axis] ?? axis;
}

function setProfile(p) {
  profile = p;
  els.profileName.textContent = p ? p.device.productName : 'None';
  els.profileNote.textContent = p
    ? `Captured ${new Date(p.capturedAt).toLocaleDateString()}. Controls are named after this joystick.`
    : 'Optional. Load the profile saved from Capture to name the controls after the real joystick and check vJoy matches it.';
  els.profileClear.hidden = !p;
  els.stProfile.textContent = p ? p.device.productName : 'None';
  if (p && identityInfo?.supported && !idEls.name.value) renderIdentity();
  if (device) buildControls();
  checkProfile();
  renderPreflight();
}

els.profileLoad.addEventListener('click', async () => {
  try {
    const p = await window.profiles.import();
    if (p) setProfile(p);
  } catch (err) {
    showAlert(els.profileWarning, 'Could not load that file', cleanError(err));
  }
});

els.profileClear.addEventListener('click', async () => {
  await window.profiles.clear();
  setProfile(null);
});

// The Capture tab saves profiles; pick them up here.
window.addEventListener('profile-saved', (e) => setProfile(e.detail));

// ---- Present as: the name Windows reports for vJoy -----------------------------------

const idEls = {
  state: $('identity-state'),
  name: $('identity-name'),
  apply: $('identity-apply'),
  restore: $('identity-restore'),
  note: $('identity-note'),
  message: $('identity-message'),
};
let identityInfo = null;

function renderIdentity() {
  const info = identityInfo;
  const supported = Boolean(info?.supported);
  idEls.name.disabled = !supported;
  idEls.apply.disabled = !supported;
  if (!supported) {
    idEls.state.textContent = 'Windows only';
    return;
  }
  idEls.state.textContent = info.current;
  idEls.restore.hidden = !('original' in info) || info.original === undefined;
  if (!idEls.name.value) idEls.name.value = profile?.device.productName ?? '';
  const pending = idEls.name.value.trim() && idEls.name.value.trim() !== info.current;
  idEls.apply.classList.toggle('primary', Boolean(pending));
}

async function loadIdentity() {
  identityInfo = await window.identity.get();
  renderIdentity();
}

idEls.name.addEventListener('input', renderIdentity);
idEls.name.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') idEls.apply.click();
});

idEls.apply.addEventListener('click', async () => {
  showAlert(idEls.message, null);
  try {
    const current = await window.identity.set(idEls.name.value);
    showAlert(idEls.message, `Now reporting "${current}"`, [
      'Close and reopen the simulation so it sees the new name.',
      'Check in joy.cpl (Win+R → joy.cpl): vJoy should be listed under this name.',
      'If the simulation still ignores it, it checks the USB IDs, and you need the hardware route.',
    ]);
  } catch (err) {
    showAlert(idEls.message, 'Could not change the name', cleanError(err));
  }
  await loadIdentity();
});

idEls.restore.addEventListener('click', async () => {
  showAlert(idEls.message, null);
  try {
    const current = await window.identity.restore();
    idEls.name.value = '';
    showAlert(idEls.message, `Restored "${current}"`, 'Restart the simulation to pick it up.');
  } catch (err) {
    showAlert(idEls.message, 'Could not restore the name', cleanError(err));
  }
  await loadIdentity();
});

// ---- Preflight: what's left before the stick goes live -----------------------------

function preflightSteps() {
  const need = profile?.vjoySetup;
  const configured = devices.some((d) => d.status !== 'missing');
  const setup = need
    ? `axes ${need.axes.map(vjoyConfName).join(', ')}; Number of Buttons ${need.buttons}; POVs Continuous, ${need.contPovs}`
    : 'the axes, buttons and POV hats your joystick has. The Capture tab shows them';
  return [
    {
      name: 'vJoy driver',
      ok: Boolean(info?.available),
      how: IS_WINDOWS
        ? 'Install vJoy 2.1.9.1 from github.com/jshafer817/vJoy/releases, then restart this app.'
        : 'vJoy runs on Windows only. On this computer you can still record a profile in Capture.',
    },
    {
      name: 'vJoy enabled',
      ok: Boolean(info?.available && info.enabled),
      how: 'Open Configure vJoy from the Start menu, tick Enable vJoy at the bottom-left and click Apply.',
    },
    {
      name: 'Device 1 configured',
      ok: Boolean(info?.available && info.enabled && configured),
      how: `In Configure vJoy select tab 1 and set ${setup}. Click Apply, then Check again.`,
    },
    {
      name: 'Joystick profile',
      ok: Boolean(profile),
      optional: true,
      how: 'Optional. Use Load… in the profile panel to pick the file you saved from Capture.',
    },
    { name: 'Connect', ok: Boolean(device), how: 'Choose the device and click Connect.' },
  ];
}

function renderPreflight() {
  const live = Boolean(device);
  els.controlView.dataset.live = String(live);
  els.preflight.hidden = live;
  els.field.tabIndex = live ? 0 : -1;
  els.field.setAttribute('role', live ? 'slider' : 'group');
  if (live) return;

  const steps = preflightSteps();
  const firstOpen = steps.find((s) => !s.ok && !s.optional);
  els.steps.replaceChildren(
    ...steps.map((s, i) => {
      const li = document.createElement('li');
      const blocked = !s.ok && firstOpen && steps.indexOf(firstOpen) < i && !s.optional;
      li.className = `step ${s.ok ? 'ok' : 'todo'}${blocked ? ' blocked' : ''}`;
      li.innerHTML = '<span class="n"></span><span class="name"></span><span class="state"></span><span class="how"></span>';
      li.querySelector('.n').textContent = String(i + 1).padStart(2, '0');
      li.querySelector('.name').textContent = s.name;
      li.querySelector('.state').textContent = s.ok ? (s.optional ? 'Loaded' : 'Done') : s.optional ? 'Optional' : blocked ? 'Waiting' : 'To do';
      li.querySelector('.how').textContent = s.how;
      return li;
    }),
  );
  const titles = {
    'vJoy driver': IS_WINDOWS ? 'Install vJoy' : 'Capture only on this computer',
    'vJoy enabled': 'Enable vJoy',
    'Device 1 configured': 'Configure vJoy device 1',
    Connect: 'Ready to connect',
  };
  els.preflightTitle.textContent = titles[firstOpen?.name] ?? 'Ready';
  const canConnect = !firstOpen || firstOpen.name === 'Connect';
  els.preflightConnect.disabled = !canConnect || !els.device.value;
}

els.preflightConnect.addEventListener('click', () => connect(Number(els.device.value)));
els.preflightRecheck.addEventListener('click', () => refresh());

// ---- Tabs and overlay ----------------------------------------------------------------

function showTab(name) {
  activeTab = name;
  for (const t of document.querySelectorAll('[data-tab-target]')) {
    t.setAttribute('aria-selected', String(t.dataset.tabTarget === name));
  }
  for (const view of document.querySelectorAll('[data-view]')) {
    view.hidden = view.dataset.view !== name;
  }
  if (name === 'control') sizeCanvas();
}

for (const tab of document.querySelectorAll('[data-tab-target]')) {
  tab.addEventListener('click', () => showTab(tab.dataset.tabTarget));
}

function applyOverlay(on) {
  document.body.classList.toggle('overlay', on);
  els.overlay.setAttribute('aria-pressed', String(on));
  els.overlay.textContent = on ? 'Unpin' : 'Pin';
  if (on) showTab('control');
}

els.overlay.addEventListener('click', () => {
  window.app.setOverlay(els.overlay.getAttribute('aria-pressed') !== 'true');
});
window.app.onOverlay(applyOverlay);

// ---- Connection --------------------------------------------------------------------------

function renderStatus() {
  let link = 'Offline';
  if (device) link = 'Live';
  else if (info && !info.available) link = 'No vJoy';
  else if (info && !info.enabled) link = 'Disabled';
  els.stLink.textContent = link;
  els.linkState.textContent = link;
  els.stageState.textContent = device ? `Live · vJoy ${String(device.id).padStart(2, '0')}` : link;
  els.stLinkBox.classList.toggle('inverted', Boolean(device));
  els.stLinkBox.classList.toggle('warn', link === 'No vJoy' || link === 'Disabled');
  els.stDevice.textContent = device
    ? `vJoy ${String(device.id).padStart(2, '0')} · ${device.axes.length}ax ${device.buttons}btn`
    : '—';
  els.connect.textContent = device ? 'Disconnect' : 'Connect';
  els.connect.classList.toggle('primary', !device && Boolean(els.device.value) && !els.connect.disabled);
  els.device.disabled = Boolean(device) || !els.device.options.length || !info?.available;
}

async function refreshDevices() {
  devices = info?.available ? await window.vjoy.devices() : [];
  const current = els.device.value;
  const usable = devices.filter((d) => d.status !== 'missing');
  els.device.replaceChildren(
    ...usable.map((d) => new Option(`#${d.id} · ${d.status}`, d.id)),
  );
  if (!usable.length) els.device.append(new Option(info?.available ? 'No devices configured' : 'vJoy unavailable', ''));
  if (current && usable.some((d) => String(d.id) === current)) els.device.value = current;
  els.connect.disabled = !usable.length && !device;
}

function setConnected(caps) {
  const changed = Boolean(caps) !== Boolean(device);
  device = caps;
  if (device) {
    buildControls();
  } else {
    buildSliders();
    buildHat();
    buildButtons();
  }
  checkProfile();
  renderStatus();
  renderPreflight();
  requestDraw();
  if (changed) flash();
}

async function connect(id) {
  showAlert(els.message, null);
  try {
    setConnected(await window.vjoy.acquire(id));
  } catch (err) {
    showAlert(els.message, 'Could not connect', cleanError(err));
  }
  await refreshDevices();
  if (device) els.device.value = device.id;
  renderStatus();
  renderPreflight();
}

els.connect.addEventListener('click', async () => {
  if (device) {
    await window.vjoy.release();
    setConnected(null);
    await refreshDevices();
    renderStatus();
    renderPreflight();
  } else {
    await connect(Number(els.device.value));
  }
});

els.device.addEventListener('change', () => { renderStatus(); renderPreflight(); });

async function refresh() {
  info = await window.vjoy.info();
  await refreshDevices();
  showAlert(els.message, null);
  if (info.available && info.driverMatch === false) {
    showAlert(els.message, 'vJoy versions differ', 'The vJoy driver and vJoyInterface.dll are different versions. Reinstall vJoy if input does not arrive.');
  }
  renderStatus();
  renderPreflight();
}

async function init() {
  const [settings, savedProfile] = await Promise.all([window.app.settings(), window.profiles.get()]);
  applyOverlay(Boolean(settings.overlay));
  setProfile(savedProfile);
  buildSliders();
  buildHat();
  buildButtons();
  await refresh();
  await loadIdentity();

  // Reconnect to the device used last time, so launching the app is all it takes.
  const last = devices.find((d) => d.id === settings.deviceId);
  if (last && (last.status === 'free' || last.status === 'owned')) await connect(last.id);
  sizeCanvas();
}

init();
