// Talks to the installed vJoy driver through vJoyInterface.dll (Windows only).
const fs = require('node:fs');
const path = require('node:path');
const koffi = require('koffi');
const { AXES, DEVICE_STATUS, MAX_DEVICES } = require('./constants');

function findDll() {
  const candidates = [
    process.env.VJOY_DLL,
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'vJoy', 'x64', 'vJoyInterface.dll'),
    'vJoyInterface.dll', // falls back to the normal DLL search path
  ].filter(Boolean);
  return candidates.find((p) => !path.isAbsolute(p) || fs.existsSync(p));
}

function createVJoyBackend() {
  const lib = koffi.load(findDll());

  // Win32 BOOL is a 32-bit int.
  const api = {
    vJoyEnabled: lib.func('int __cdecl vJoyEnabled()'),
    GetvJoyVersion: lib.func('int16_t __cdecl GetvJoyVersion()'),
    GetvJoyProductString: lib.func('const char16_t * __cdecl GetvJoyProductString()'),
    GetvJoyManufacturerString: lib.func('const char16_t * __cdecl GetvJoyManufacturerString()'),
    DriverMatch: lib.func('int __cdecl DriverMatch(_Out_ uint16_t *DllVer, _Out_ uint16_t *DrvVer)'),
    GetVJDStatus: lib.func('int __cdecl GetVJDStatus(uint32_t rID)'),
    AcquireVJD: lib.func('int __cdecl AcquireVJD(uint32_t rID)'),
    RelinquishVJD: lib.func('void __cdecl RelinquishVJD(uint32_t rID)'),
    ResetVJD: lib.func('int __cdecl ResetVJD(uint32_t rID)'),
    GetVJDButtonNumber: lib.func('int __cdecl GetVJDButtonNumber(uint32_t rID)'),
    GetVJDDiscPovNumber: lib.func('int __cdecl GetVJDDiscPovNumber(uint32_t rID)'),
    GetVJDContPovNumber: lib.func('int __cdecl GetVJDContPovNumber(uint32_t rID)'),
    GetVJDAxisExist: lib.func('int __cdecl GetVJDAxisExist(uint32_t rID, uint32_t Axis)'),
    GetVJDAxisMin: lib.func('int __cdecl GetVJDAxisMin(uint32_t rID, uint32_t Axis, _Out_ int32_t *Min)'),
    GetVJDAxisMax: lib.func('int __cdecl GetVJDAxisMax(uint32_t rID, uint32_t Axis, _Out_ int32_t *Max)'),
    SetAxis: lib.func('int __cdecl SetAxis(int32_t Value, uint32_t rID, uint32_t Axis)'),
    SetBtn: lib.func('int __cdecl SetBtn(int Value, uint32_t rID, uint8_t nBtn)'),
    SetDiscPov: lib.func('int __cdecl SetDiscPov(int Value, uint32_t rID, uint8_t nPov)'),
    SetContPov: lib.func('int __cdecl SetContPov(uint32_t Value, uint32_t rID, uint8_t nPov)'),
  };

  function readAxisRange(id, usage) {
    const min = [0];
    const max = [0];
    api.GetVJDAxisMin(id, usage, min);
    api.GetVJDAxisMax(id, usage, max);
    return { min: min[0], max: max[0] };
  }

  return {
    name: 'vjoy',

    info() {
      const enabled = Boolean(api.vJoyEnabled());
      if (!enabled) return { backend: 'vjoy', enabled };
      const dllVer = [0];
      const drvVer = [0];
      const match = Boolean(api.DriverMatch(dllVer, drvVer));
      return {
        backend: 'vjoy',
        enabled,
        product: api.GetvJoyProductString(),
        manufacturer: api.GetvJoyManufacturerString(),
        version: api.GetvJoyVersion(),
        driverMatch: match,
        dllVersion: dllVer[0],
        driverVersion: drvVer[0],
      };
    },

    listDevices() {
      const devices = [];
      for (let id = 1; id <= MAX_DEVICES; id++) {
        devices.push({ id, status: DEVICE_STATUS[api.GetVJDStatus(id)] ?? 'unknown' });
      }
      return devices;
    },

    acquire(id) {
      const status = DEVICE_STATUS[api.GetVJDStatus(id)];
      if (status !== 'owned' && status !== 'free') {
        throw new Error(`vJoy device ${id} is ${status}`);
      }
      if (status === 'free' && !api.AcquireVJD(id)) {
        throw new Error(`Failed to acquire vJoy device ${id}`);
      }
      api.ResetVJD(id);
      return {
        id,
        axes: AXES.filter((a) => api.GetVJDAxisExist(id, a.usage)).map((a) => ({
          ...a,
          ...readAxisRange(id, a.usage),
        })),
        buttons: api.GetVJDButtonNumber(id),
        discPovs: api.GetVJDDiscPovNumber(id),
        contPovs: api.GetVJDContPovNumber(id),
      };
    },

    release(id) {
      api.RelinquishVJD(id);
    },

    reset(id) {
      api.ResetVJD(id);
    },

    setAxis(id, usage, value) {
      return Boolean(api.SetAxis(value, id, usage));
    },

    setButton(id, button, pressed) {
      return Boolean(api.SetBtn(pressed ? 1 : 0, id, button));
    },

    // Discrete POV: -1 neutral, 0 N, 1 E, 2 S, 3 W.
    setDiscPov(id, pov, direction) {
      return Boolean(api.SetDiscPov(direction, id, pov));
    },

    // Continuous POV: hundredths of a degree (0..35999), 0xFFFFFFFF neutral.
    setContPov(id, pov, centiDegrees) {
      return Boolean(api.SetContPov(centiDegrees < 0 ? 0xffffffff : centiDegrees, id, pov));
    },
  };
}

module.exports = { createVJoyBackend };
