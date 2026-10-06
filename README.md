# Joystick Emulator

A Windows app that stands in for a physical joystick. You drag an on-screen stick, and the app moves a [vJoy](https://github.com/jshafer817/vJoy/releases) virtual joystick, which your simulation reads like a real one.

vJoy shows up as **"vJoy Device"**, not as a Thrustmaster. Your simulation has to accept a generic joystick, and you'll usually rebind its controls to the vJoy device once.

## Downloads

`npm run dist` produces, in `dist/`:

- `Joystick Emulator-Setup-<version>.exe`: installer, no admin rights needed.
- `Joystick Emulator-<version>-portable.exe`: a single exe, nothing to install.

The builds are unsigned, so Windows SmartScreen will warn on first launch. Click **More info → Run anyway**.

## 1. At the office: capture the real joystick (once)

No vJoy is needed for this step.

1. Plug in the joystick and start the app (the portable exe is easiest).
2. Open the **Capture** tab and click **Choose joystick…**. Thrustmaster devices are outlined.
3. Move every axis and press every button, and check the table and button lights react. If the values look scrambled, click **Try other field order** (shown only when it applies).
4. Click **Save profile…** and keep the `.profile.json` file (email it to yourself, put it on a USB stick, …).

The profile records the joystick's axes, buttons and hat, and the matching vJoy setup, shown under **vJoy setup to match**.

## 2. At home: set up the laptop (once)

1. Install **vJoy 2.1.9.1** from the link above. It needs admin rights and possibly a reboot.
2. Open **Configure vJoy** from the Start menu. Enable device **1** and set it to match **vJoy setup to match** from the profile. For a T.16000M that's: axes **X, Y, Rz, Slider**; **16 buttons**; **1 continuous POV**. Click **Apply**.
3. Install or start Joystick Emulator, click **Load profile…** and pick the saved profile.
4. Click **Connect**. If the vJoy device doesn't match the profile, the app says exactly what to change.
5. In the simulation, bind its controls to **vJoy Device**.

From then on, the app reconnects to the same vJoy device and remembers the profile every time it starts.

## Flying

- Until vJoy is connected, a **Preflight** checklist inside the stick area shows what's left to do, with the exact Configure vJoy steps.
- **Pin** (top-right) makes the window small and always on top, and clicks on it don't take focus from the simulation. **Unpin** restores it.
- Drag the stick area for X/Y. Hold **Shift** for fine control; double-click or **Centre** to recentre. With **Self-centre** on, it springs back when released. The Twist slider is Rz; other axes, such as the throttle, are named after the real joystick's controls.
- Hold a hat or button cell to press it. **Right-click or double-tap** latches it on, so it stays held while you move the stick.
- The title bar always shows **LINK** (inverted when live) and **TX**, the number of updates sent to vJoy per second.
- The keyboard works only while the window is focused: `WASD` stick, `Q`/`E` twist, `1`–`0` buttons, `IJKL` hat, and arrow keys nudge the stick when it's focused.

**Mirror to vJoy** (Capture tab) copies a real joystick onto vJoy live. With vJoy installed on the same PC, it's a quick way to confirm the simulation behaves the same with vJoy as with the real stick.

## Troubleshooting

| Message | Fix |
|---|---|
| vJoy could not be loaded | Install vJoy, then restart the app. If it lives somewhere other than `C:\Program Files\vJoy`, set `VJOY_DLL` to the full path of `x64\vJoyInterface.dll`. |
| vJoy is installed but disabled | Tick **Enable vJoy** in Configure vJoy. |
| No vJoy devices are enabled | Enable device 1 in Configure vJoy and click Apply. |
| vJoy device N is busy | Another program (e.g. a second copy, or a feeder app) owns it. Close that program. |
| Simulation ignores input | Make sure it's bound to "vJoy Device", and fly from **Overlay** so the simulation keeps focus. |

## Development

```bash
npm install
npm start      # on macOS/Linux only the Capture tab works (vJoy is Windows-only)
npm run dist   # builds the Windows installer + portable exe (works from macOS too)
```

```
src/main/main.js               window, IPC, overlay mode, profile import/export
src/main/store.js              settings + active profile in the user-data folder
src/main/vjoy/vjoy-backend.js  vJoyInterface.dll bindings (koffi FFI)
src/preload/preload.js         the renderer's API
src/renderer/renderer.js       Control tab
src/renderer/capture.js        Capture tab (WebHID)
src/renderer/hid-layout.js     HID report layout, decoding, vJoy mapping
scripts/fetch-win-koffi.js     fetches koffi's Windows binary when building off Windows
```
