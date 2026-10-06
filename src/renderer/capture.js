// Capture tab: read a real joystick over WebHID, show its layout and live values,
// optionally mirror it onto vJoy, and save a profile describing it.
// Shares `$`, `out`, `device`, `stick`, `setStick`, `sliders`, `showAlert` and `vjoyConfName` with renderer.js.
(() => {
  const THRUSTMASTER_VID = 0x044f;
  const JOYSTICK_FILTERS = [
    { usagePage: 0x01, usage: 0x04 }, // joystick
    { usagePage: 0x01, usage: 0x05 }, // gamepad
    { usagePage: 0x01, usage: 0x08 }, // multi-axis controller
  ];

  const els = {
    choose: $('hid-choose'),
    name: $('hid-name'),
    order: $('hid-order'),
    mirror: $('hid-mirror'),
    save: $('hid-save'),
    saved: $('hid-saved'),
    picker: $('hid-picker'),
    pickerList: $('hid-picker-list'),
    pickerCancel: $('hid-picker-cancel'),
    warningBox: $('hid-warning-box'),
    warning: $('hid-warning'),
    rate: $('hid-rate'),
    fields: $('hid-fields'),
    buttons: $('hid-buttons'),
    vjoy: $('hid-vjoy'),
    raw: $('hid-raw'),
  };

  let hid = null; // the open HIDDevice
  let layout = null;
  let rows = {}; // field.key -> { bar, output } or button cell
  const latest = {}; // field.key -> raw value
  const sent = {}; // field.key -> last value mirrored to vJoy
  let lastRaw = null;
  let reportCount = 0;
  let renderQueued = false;

  const { hex } = window.HidLayout;

  function warn(title, body) {
    els.warningBox.hidden = !title;
    if (title) showAlert(els.warning, title, body);
  }

  function allFields() {
    return layout ? layout.reports.flatMap((r) => r.fields) : [];
  }

  function mirroring() {
    return els.mirror.getAttribute('aria-checked') === 'true';
  }

  // ---- Device picker (fed by the main process's select-hid-device handler) ----

  window.hidChooser.onChoose((list) => {
    els.pickerList.replaceChildren();
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'note';
      p.style.padding = '12px 16px';
      p.textContent = 'No joysticks found. Plug it in, wait a moment, then click Choose joystick… again.';
      els.pickerList.append(p);
    }
    // Thrustmaster devices first.
    const sorted = [...list].sort((a, b) => (b.vendorId === THRUSTMASTER_VID) - (a.vendorId === THRUSTMASTER_VID));
    for (const d of sorted) {
      const b = document.createElement('button');
      const name = document.createElement('span');
      name.textContent = d.name || 'Unnamed device';
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = d.vendorId === THRUSTMASTER_VID ? 'Thrustmaster' : `${hex(d.vendorId)}:${hex(d.productId)}`;
      b.append(name, tag);
      b.addEventListener('click', () => {
        els.picker.hidden = true;
        window.hidChooser.choose(d.deviceId);
      });
      els.pickerList.append(b);
    }
    els.picker.hidden = false;
    els.pickerList.querySelector('button')?.focus();
  });

  els.pickerCancel.addEventListener('click', () => {
    els.picker.hidden = true;
    window.hidChooser.choose(null);
  });

  els.choose.addEventListener('click', async () => {
    warn(null);
    try {
      const [chosen] = await navigator.hid.requestDevice({ filters: JOYSTICK_FILTERS });
      if (chosen) await openDevice(chosen);
    } catch (err) {
      warn('Could not open the joystick', `${err.message} Close other apps that might be using it and try again.`);
    }
  });

  navigator.hid.addEventListener('disconnect', (e) => {
    if (e.device === hid) warn('Joystick disconnected', 'Plug it back in and choose it again.');
  });

  // ---- Opening and laying out a device ---------------------------------------

  async function openDevice(next) {
    if (hid) {
      hid.removeEventListener('inputreport', onReport);
      if (hid.opened) await hid.close();
    }
    hid = next;
    if (!hid.opened) await hid.open();
    hid.addEventListener('inputreport', onReport);

    els.name.textContent = `${hid.productName || 'Unnamed device'} · ${hex(hid.vendorId)}:${hex(hid.productId)}`;
    els.choose.textContent = 'Change…';
    els.save.disabled = false;
    els.saved.textContent = "Saves the joystick's layout, to load on the other PC.";
    applyLayout(window.HidLayout.buildLayout(hid.collections));
  }

  function applyLayout(next) {
    layout = next;
    for (const k of Object.keys(latest)) delete latest[k];
    for (const k of Object.keys(sent)) delete sent[k];
    els.order.hidden = !layout.reports.some((r) => r.spansCollections);
    renderTable();
    renderSetup();
  }

  els.order.addEventListener('click', () => {
    const order = layout.order === 'parent-first' ? 'children-first' : 'parent-first';
    applyLayout(window.HidLayout.buildLayout(hid.collections, order));
  });

  function renderTable() {
    rows = {};
    els.fields.replaceChildren();
    els.buttons.replaceChildren();
    const fields = allFields();

    for (const f of fields.filter((x) => x.kind === 'axis' || x.kind === 'hat' || x.kind === 'other')) {
      const tr = document.createElement('tr');
      const cells = [
        f.name,
        `${hex(f.usage >>> 16, 2)}:${hex(f.usage & 0xffff, 2)}`,
        `${f.bitSize}b @${f.bitOffset}`,
        `${f.logicalMin}…${f.logicalMax}`,
        f.vjoy ? vjoyConfName(f.vjoy) : '—',
      ];
      for (const text of cells) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      const live = document.createElement('td');
      live.className = 'live';
      live.innerHTML = '<div class="meter"><div class="bar"><i></i></div><output>—</output></div>';
      tr.append(live);
      els.fields.append(tr);
      rows[f.key] = { bar: live.querySelector('.bar'), output: live.querySelector('output') };
    }
    if (!els.fields.children.length) {
      els.fields.innerHTML = '<tr><td colspan="6">This device reports no axes or hats.</td></tr>';
    }

    for (const f of fields.filter((x) => x.kind === 'button')) {
      const cell = document.createElement('div');
      cell.textContent = String(f.button).padStart(2, '0');
      els.buttons.append(cell);
      rows[f.key] = cell;
    }
    if (!els.buttons.children.length) els.buttons.innerHTML = '<p class="empty">No buttons found.</p>';
  }

  function renderSetup() {
    const setup = window.HidLayout.vjoySetup(layout);
    const items = [
      ['Axes', setup.axes.map(vjoyConfName).join(', ') || 'None'],
      ['Buttons', String(setup.buttons)],
      ['POV hats', setup.contPovs ? `${setup.contPovs} · continuous` : 'None'],
    ];
    els.vjoy.replaceChildren(
      ...items.flatMap(([label, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        return [dt, dd];
      }),
    );
  }

  // ---- Live reports ----------------------------------------------------------

  function onReport(e) {
    const report = layout?.reports.find((r) => r.reportId === e.reportId);
    const bytes = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    lastRaw = { reportId: e.reportId, bytes };
    reportCount++;
    if (!report) return;

    const actualBits = bytes.length * 8;
    if (report.bitLength > actualBits || actualBits - report.bitLength >= 8) {
      warn('Layout mismatch', `Report ${e.reportId} is ${bytes.length} bytes but the layout expects ${Math.ceil(report.bitLength / 8)}. Values may be wrong.`);
    }

    Object.assign(latest, window.HidLayout.decode(report, bytes));
    if (mirroring()) mirror(report);
    if (!renderQueued) {
      renderQueued = true;
      requestAnimationFrame(render);
    }
  }

  // Drives the Control tab's own controls, so the field shows what's being sent.
  function mirror(report) {
    let moved = false;
    for (const f of report.fields) {
      if (!f.vjoy || !(f.key in latest) || sent[f.key] === latest[f.key]) continue;
      sent[f.key] = latest[f.key];
      const v = window.HidLayout.normalise(f, latest[f.key]);
      if (f.kind === 'axis') {
        if (f.vjoy === 'X') { stick.x = v; moved = true; }
        else if (f.vjoy === 'Y') { stick.y = v; moved = true; }
        else if (sliders[f.vjoy]) sliders[f.vjoy].set(v);
        else out.axis(f.vjoy, v);
      } else if (f.kind === 'button') {
        out.button(f.button, v !== 0);
      } else if (f.kind === 'hat') {
        out.pov(Number(f.vjoy.split(' ')[1]), v);
      }
    }
    if (moved) setStick(stick.x, stick.y);
  }

  els.mirror.addEventListener('click', () => {
    const on = !mirroring();
    for (const k of Object.keys(sent)) delete sent[k];
    if (on && !device) {
      warn('Connect vJoy first', 'Mirroring needs a connected vJoy device. Connect one in the Control tab, then switch this on.');
      return;
    }
    els.mirror.setAttribute('aria-checked', String(on));
    warn(null);
  });

  function render() {
    renderQueued = false;
    for (const f of allFields()) {
      const row = rows[f.key];
      if (!row || !(f.key in latest)) continue;
      const v = latest[f.key];
      if (f.kind === 'button') {
        row.classList.toggle('on', v !== 0);
      } else if (f.kind === 'hat') {
        const angle = window.HidLayout.normalise(f, v);
        row.bar.style.setProperty('--v', angle < 0 ? 0 : angle / 360);
        row.output.textContent = angle < 0 ? 'Centre' : `${Math.round(angle)}°`;
      } else {
        const span = f.logicalMax - f.logicalMin;
        row.bar.style.setProperty('--v', span > 0 ? (v - f.logicalMin) / span : 0);
        row.output.textContent = v;
      }
    }
    if (lastRaw) {
      const prefix = lastRaw.reportId ? `ID ${hex(lastRaw.reportId, 2)} · ` : '';
      els.raw.textContent = prefix + Array.from(lastRaw.bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    }
  }

  setInterval(() => {
    els.rate.textContent = hid ? `${String(reportCount).padStart(3, '0')} reports/s` : '';
    reportCount = 0;
  }, 1000);

  // ---- Profile ---------------------------------------------------------------

  els.save.addEventListener('click', async () => {
    const profile = {
      format: 'joystick-emulator-profile/1',
      capturedAt: new Date().toISOString(),
      device: {
        productName: hid.productName || 'Joystick',
        vendorId: hid.vendorId,
        productId: hid.productId,
      },
      vjoySetup: window.HidLayout.vjoySetup(layout),
      fieldOrder: layout.order,
      reports: layout.reports,
      collections: window.HidLayout.serialiseCollections(hid.collections),
    };
    try {
      const saved = await window.profiles.save(profile);
      if (!saved) return;
      window.dispatchEvent(new CustomEvent('profile-saved', { detail: saved.profile }));
      warn(null);
      els.saved.textContent = `Saved to ${saved.filePath}. Copy this file to the PC you'll fly on, and use Load… in the Control tab there.`;
    } catch (err) {
      warn('Could not save the profile', err.message);
    }
  });
})();
