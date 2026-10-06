const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const store = require('./store');
const identity = require('./identity');

const VJOY_DOWNLOAD = 'https://github.com/jshafer817/vJoy/releases';

// Only one instance may own the vJoy device; a second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function loadBackend() {
  if (process.platform !== 'win32') {
    return { backend: null, error: 'vJoy is only available on Windows.' };
  }
  try {
    const { createVJoyBackend } = require('./vjoy/vjoy-backend');
    return { backend: createVJoyBackend(), error: null };
  } catch (err) {
    return { backend: null, error: `vJoy could not be loaded (${err.message}). Install vJoy from ${VJOY_DOWNLOAD} and restart the app.` };
  }
}

const { backend, error: backendError } = loadBackend();

let win = null;
// The device currently acquired, with the capabilities vJoy reported for it.
let device = null;

function clamp01(v) {
  return Math.min(1, Math.max(0, Number(v) || 0));
}

function requireBackend() {
  if (!backend) throw new Error(backendError);
}

function releaseDevice() {
  if (!device) return;
  backend.reset(device.id);
  backend.release(device.id);
  device = null;
}

// ---- Overlay mode: small, always on top, and (on Windows) never takes focus, so
// the simulation keeps receiving input while you drag the on-screen stick.

const NORMAL_MIN = { width: 360, height: 520 };
const OVERLAY_SIZE = { width: 380, height: 760 };

function setOverlay(on) {
  if (!win) return;
  const settings = store.settings.get();
  if (on) {
    if (!settings.overlay) store.settings.update({ normalBounds: win.getBounds() });
    win.setMinimumSize(320, 420);
    win.setBounds({ ...(settings.overlayBounds ?? OVERLAY_SIZE) });
    win.setAlwaysOnTop(true, 'floating');
    if (process.platform !== 'darwin') win.setFocusable(false);
  } else {
    if (settings.overlay) store.settings.update({ overlayBounds: win.getBounds() });
    win.setAlwaysOnTop(false);
    if (process.platform !== 'darwin') win.setFocusable(true);
    win.setMinimumSize(NORMAL_MIN.width, NORMAL_MIN.height);
    if (settings.normalBounds) win.setBounds(settings.normalBounds);
  }
  store.settings.update({ overlay: on });
  win.webContents.send('window:overlay', on);
}

// ---- IPC ---------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('vjoy:info', () => {
    if (!backend) return { available: false, error: backendError };
    return { available: true, ...backend.info(), download: VJOY_DOWNLOAD };
  });

  ipcMain.handle('vjoy:devices', () => (backend ? backend.listDevices() : []));

  ipcMain.handle('vjoy:acquire', (_e, id) => {
    requireBackend();
    const deviceId = Number(id);
    if (!Number.isInteger(deviceId) || deviceId < 1 || deviceId > 16) {
      throw new Error(`Invalid device id: ${id}`);
    }
    releaseDevice();
    device = backend.acquire(deviceId);
    store.settings.update({ deviceId });
    return device;
  });

  ipcMain.handle('vjoy:release', () => {
    releaseDevice();
    store.settings.update({ deviceId: null });
  });

  // High-frequency updates use fire-and-forget `send` rather than `invoke`.
  ipcMain.on('vjoy:axis', (_e, name, value) => {
    const axis = device?.axes.find((a) => a.name === name);
    if (!axis) return;
    const raw = Math.round(axis.min + clamp01(value) * (axis.max - axis.min));
    backend.setAxis(device.id, axis.usage, raw);
  });

  ipcMain.on('vjoy:button', (_e, button, pressed) => {
    const n = Number(button);
    if (!device || !Number.isInteger(n) || n < 1 || n > device.buttons) return;
    backend.setButton(device.id, n, Boolean(pressed));
  });

  // `angle` is in degrees clockwise from north, or -1 for centred.
  ipcMain.on('vjoy:pov', (_e, pov, angle) => {
    const n = Number(pov);
    const deg = Number(angle);
    if (!device || !Number.isInteger(n) || n < 1) return;
    if (n <= device.contPovs) {
      backend.setContPov(device.id, n, deg < 0 ? -1 : Math.round((((deg % 360) + 360) % 360) * 100));
    } else if (n <= device.discPovs) {
      // Discrete hats only have 4 directions; diagonals snap to the nearest one.
      backend.setDiscPov(device.id, n, deg < 0 ? -1 : Math.round(deg / 90) % 4);
    }
  });

  ipcMain.handle('settings:get', () => store.settings.get());

  // "Present as": the joystick name Windows reports for vJoy devices.
  ipcMain.handle('identity:get', async () => {
    if (process.platform !== 'win32') return { supported: false };
    const current = await identity.getName();
    return { supported: true, current: current ?? identity.VJOY_DEFAULT, original: store.settings.get().originalOemName };
  });

  ipcMain.handle('identity:set', async (_e, name) => {
    if (process.platform !== 'win32') throw new Error('Only available on Windows.');
    // Remember what was there before the first change, so it can be restored.
    if (!('originalOemName' in store.settings.get())) {
      store.settings.update({ originalOemName: await identity.getName() });
    }
    return identity.setName(name);
  });

  ipcMain.handle('identity:restore', async () => {
    if (process.platform !== 'win32') throw new Error('Only available on Windows.');
    const { originalOemName } = store.settings.get();
    const current = originalOemName ? await identity.setName(originalOemName) : await identity.clearName();
    store.settings.update({ originalOemName: undefined });
    return current ?? identity.VJOY_DEFAULT;
  });

  ipcMain.handle('window:overlay', (_e, on) => setOverlay(Boolean(on)));

  ipcMain.handle('profile:get', () => store.profile.get());

  ipcMain.handle('profile:clear', () => store.profile.clear());

  ipcMain.handle('profile:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Load joystick profile',
      filters: [{ name: 'Joystick profile', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return null;
    const profile = store.validateProfile(JSON.parse(fs.readFileSync(filePaths[0], 'utf8')));
    store.profile.set(profile);
    return profile;
  });

  // Saves a captured profile to a file (to carry home) and makes it the active one.
  ipcMain.handle('profile:save', async (_e, profile) => {
    store.validateProfile(profile);
    const name = profile.device.productName.replace(/[^\w-]+/g, '-') || 'joystick';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save joystick profile',
      defaultPath: path.join(app.getPath('documents'), `${name}.profile.json`),
      filters: [{ name: 'Joystick profile', extensions: ['json'] }],
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
    store.profile.set(profile);
    return { profile, filePath };
  });
}

// WebHID: let the renderer read joysticks, and route Chromium's device chooser to
// our own picker in the Capture tab.
function setupHid() {
  const ses = win.webContents.session;
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'hid');
  ses.setDevicePermissionHandler((details) => details.deviceType === 'hid');

  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const list = details.deviceList.map((d) => ({
      deviceId: d.deviceId,
      name: d.name,
      vendorId: d.vendorId,
      productId: d.productId,
    }));
    win.webContents.send('hid:choose', list);
    ipcMain.removeAllListeners('hid:chosen');
    ipcMain.once('hid:chosen', (_e, id) => {
      callback(list.some((d) => d.deviceId === id) ? id : undefined);
    });
  });
}

function createWindow() {
  const settings = store.settings.get();
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    ...(settings.normalBounds ?? {}),
    minWidth: NORMAL_MIN.width,
    minHeight: NORMAL_MIN.height,
    title: 'Joystick Emulator',
    backgroundColor: '#000000',
    show: false,
    // The app draws its own title bar; the OS keeps only the window buttons.
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin'
      ? true
      : { color: '#000000', symbolColor: '#ffffff', height: 44 },
    trafficLightPosition: { x: 14, y: 15 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Keep responding while the simulation window is in front.
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  setupHid();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (settings.overlay) setOverlay(true);
    win.show();
  });
  win.on('close', () => {
    store.settings.update(store.settings.get().overlay
      ? { overlayBounds: win.getBounds() }
      : { normalBounds: win.getBounds() });
  });
  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
});

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (!win) createWindow();
  });
});

app.on('before-quit', releaseDevice);

app.on('window-all-closed', () => {
  releaseDevice();
  if (process.platform !== 'darwin') app.quit();
});
