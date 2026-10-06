---
name: Joystick Emulator
description: Signal field. A black-and-white data instrument for driving a virtual joystick.
colors:
  void: "#000000"
  lumin: "#ffffff"
typography:
  display:
    fontFamily: "Departure Mono, JetBrains Mono, monospace"
    fontSize: "33px"
    lineHeight: 1
    letterSpacing: "0.02em"
  value:
    fontFamily: "Departure Mono, JetBrains Mono, monospace"
    fontSize: "22px"
    lineHeight: 1
  label:
    fontFamily: "Departure Mono, JetBrains Mono, monospace"
    fontSize: "11px"
    letterSpacing: "0.08em"
  body:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  none: "0px"
spacing:
  hair: "1px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button:
    backgroundColor: "{colors.void}"
    textColor: "{colors.lumin}"
    rounded: "{rounded.none}"
    height: "44px"
  button-primary:
    backgroundColor: "{colors.lumin}"
    textColor: "{colors.void}"
    rounded: "{rounded.none}"
    height: "44px"
  titlebar:
    backgroundColor: "{colors.void}"
    textColor: "{colors.lumin}"
    height: "44px"
---

## Overview

**Signal field.** The app is an instrument that shows and emits a signal. It is drawn after Ryoji Ikeda's *datamatics*: pure black, pure white, hairline bar fields and tabular numerals. The stick pad is the signal itself: a canvas of vertical bars that thicken around the stick position, with a trace of recent motion. Everything else is a module reading out values.

The mode is Operate. Expression never hides state: connection status, what's being sent and what to do next are always legible.

## Colors

There are two values only: `void` #000 and `lumin` #fff. No greys and no hues.

- Hierarchy comes from size, case and density, never from tinting text grey.
- **Active, pressed or selected** = inversion (white fill, black text).
- **Disabled** = a dashed hairline border; the text stays white.
- **Live** = the LINK readout inverted in the title bar, plus `LIVE · VJOY 01` at 22px over the field.
- **Warning or error** = an inverted block with a bar-pattern edge (title-bar readouts get the bar edge without inversion). It is never coloured.
- Canvas antialiasing may produce intermediate values. That's the medium, not a palette.

## Typography

- **Departure Mono** (pixel mono, MIT) for labels, values and numerals, always uppercase for labels. Sizes stay on its 11px grid: 11 / 22 / 33 / 44.
- **JetBrains Mono** (OFL) at 13px, sentence case, for instructions and longer messages, where pixel type would hurt reading.
- Numbers are tabular, and signed values always show the sign: `+0.250`, `-1.000`.

## Layout

- A custom title bar (44px) is part of the UI. It holds the mark, the Control/Capture tabs, the live status readouts and the pin (overlay) toggle. The window controls sit in the OS overlay area: `env(titlebar-area-*)`.
- **Wide (≥ 860px):** stick field left (square, as large as fits), instrument column right (340px).
- **Narrow (< 860px) and overlay:** a single column with the stick field first. The title bar drops the mark and readout labels, keeping LINK and TX values. Pinned mode hides the profile module, and the link module once live.
- The stage foot carries X/Y/RZ readouts (33px wide, 22px narrow) and a 6-second X (solid) / Y (dashed) history trace over a bar ruler.
- Modules are separated by 1px hairlines, not cards. There is no nesting.

## Elevation & Depth

Flat. There are no shadows. Depth comes from inversion and bar density only.

## Shapes

Square corners everywhere. 1px hairline borders. Bar glyphs (`||||`) cap primary actions.

## Components

- **Button:** 44px tall, hairline border, uppercase Departure label. Primary = inverted. Hover = bar pattern inside the border. Focus = 1px outline offset 3px.
- **Slider:** a custom `role="slider"`, 44px hit area, a hairline track filled with a bar pattern up to the value, and a solid white thumb. Arrow, PageUp/PageDown, Home and End keys work.
- **Switch:** two cells, `OFF | ON`; the active cell is inverted.
- **Control button:** a 44px square cell with its number. Pressed = inverted. Latched (right-click or double-tap) = inverted with an inner ring and a bar-pattern corner mark.
- **Preflight:** a numbered checklist inside the field while not linked. Only the first open step shows its instructions; later ones read WAITING.
- **Status readout:** an 11px label over a 22px value.

## Do's and Don'ts

- Do keep the stick field the largest element in every layout.
- Do show units and signs on every number.
- Don't add colour, grey text, rounded corners, shadows or gradients.
- Don't strobe. A single-frame inversion marks connection changes only, and never under reduced motion.
