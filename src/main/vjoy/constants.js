// HID usage IDs vJoy uses to address axes.
const AXES = [
  { name: 'X', usage: 0x30 },
  { name: 'Y', usage: 0x31 },
  { name: 'Z', usage: 0x32 },
  { name: 'Rx', usage: 0x33 },
  { name: 'Ry', usage: 0x34 },
  { name: 'Rz', usage: 0x35 },
  { name: 'Slider0', usage: 0x36 },
  { name: 'Slider1', usage: 0x37 },
];

// Values returned by GetVJDStatus().
const DEVICE_STATUS = ['owned', 'free', 'busy', 'missing', 'unknown'];

const MAX_DEVICES = 16;

module.exports = { AXES, DEVICE_STATUS, MAX_DEVICES };
