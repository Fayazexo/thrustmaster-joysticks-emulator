const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vjoy', {
  info: () => ipcRenderer.invoke('vjoy:info'),
  devices: () => ipcRenderer.invoke('vjoy:devices'),
  acquire: (id) => ipcRenderer.invoke('vjoy:acquire', id),
  release: () => ipcRenderer.invoke('vjoy:release'),
  setAxis: (name, value01) => ipcRenderer.send('vjoy:axis', name, value01),
  setButton: (n, pressed) => ipcRenderer.send('vjoy:button', n, pressed),
  setPov: (n, angleDeg) => ipcRenderer.send('vjoy:pov', n, angleDeg),
});

contextBridge.exposeInMainWorld('app', {
  settings: () => ipcRenderer.invoke('settings:get'),
  setTwistAxis: (axis) => ipcRenderer.invoke('settings:twist-axis', axis),
  setOverlay: (on) => ipcRenderer.invoke('window:overlay', on),
  onOverlay: (cb) => ipcRenderer.on('window:overlay', (_e, on) => cb(on)),
});

contextBridge.exposeInMainWorld('profiles', {
  get: () => ipcRenderer.invoke('profile:get'),
  import: () => ipcRenderer.invoke('profile:import'),
  save: (profile) => ipcRenderer.invoke('profile:save', profile),
  clear: () => ipcRenderer.invoke('profile:clear'),
});

contextBridge.exposeInMainWorld('identity', {
  get: () => ipcRenderer.invoke('identity:get'),
  set: (name) => ipcRenderer.invoke('identity:set', name),
  restore: () => ipcRenderer.invoke('identity:restore'),
});

contextBridge.exposeInMainWorld('hidChooser', {
  onChoose: (cb) => ipcRenderer.on('hid:choose', (_e, list) => cb(list)),
  choose: (deviceId) => ipcRenderer.send('hid:chosen', deviceId),
});
