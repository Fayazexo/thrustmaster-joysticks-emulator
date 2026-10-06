# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Electron desktop app; the target OS is Windows (x64). On macOS/Linux only the Capture tab works.

## Users
People who work with a Windows simulation that is normally controlled with a physical Thrustmaster joystick, and who need to run it without that hardware, most often when working remotely on a laptop. The app started as a personal tool, but it will be shared more widely, so first-time users won't know vJoy or HID terms.

## Product Purpose
Stand in for a physical joystick. The user drags an on-screen stick, plus twist, throttle, hat and buttons. The app drives a vJoy virtual joystick that the simulation reads like the real one. Success means the simulation can be flown at home with no joystick attached.

## Positioning
It mirrors a specific real joystick: a one-time Capture of the physical device records its layout as a profile. At home, the virtual device is checked against that profile and the controls carry the real joystick's names. It is not a generic gamepad mapper.

## Operating Context
- Office, once: plug in the real joystick, open Capture, check every control reacts, then save a `.profile.json`.
- Home: install vJoy, configure device 1 in "Configure vJoy" to match the profile, load the profile, connect, and bind the simulation to "vJoy Device".
- Flying: the simulation and the emulator usually sit **side by side** on the laptop screen. Overlay mode (always on top, doesn't take focus) exists for simulations that only read joysticks while focused.
- Input to the on-screen controls varies: trackpad, mouse or touchscreen, on different days.

## Capabilities and Constraints
- Control: X/Y stick pad (optional self-centre), twist (Rz), extra axes as sliders (throttle etc.), 8-way hat, buttons. Keyboard shortcuts work only while the app window is focused.
- Capture: WebHID read of a real joystick, live decoded values, raw report, and the matching vJoy setup; saves a profile. Mirror to vJoy copies a real stick live.
- vJoy shows up as "vJoy Device" (IDs 1234:BEAD), not as a Thrustmaster. Up to 16 vJoy slots; the app uses one device at a time.
- One instance at a time; it remembers the last device, the profile, overlay state and window bounds.
- Unsigned builds (SmartScreen warning). The vJoy driver (2.1.9.1) is a separate install.

## Brand Commitments
Name: "Joystick Emulator". App icon: build/icon.svg. The voice is plain, with no jargon in user-facing copy: explain vJoy steps concretely.

## Evidence on Hand
No testimonials, metrics or customer claims exist; none should be invented.

## Product Principles
1. The stick is the product: it must be the largest, most direct thing on screen, and work by trackpad, mouse or touch.
2. Never leave the user guessing about connection state. Whether vJoy is ready and what's being sent must always be visible.
3. Every error says exactly what to do next, in Configure vJoy terms.
4. It must work in a narrow column beside the simulation, not only maximised.

## Accessibility & Inclusion
Touch use requires large hit targets (≥44px). Keyboard focus must be visible.
