// Capture tab: read a real joystick over WebHID, show its layout and live values,
// optionally mirror it onto vJoy, and save a profile describing it.
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
    picker: $('hid-picker'),
    pickerList: $('hid-picker-list'),
    pickerCancel: $('hid-picker-cancel'),
    warning: $('hid-warning'),
    rate: $('hid-rate'),
    fields: $('hid-fields'),
    buttons: $('hid-buttons'),
    vjoy: $('hid-vjoy'),
    raw: $('hid-raw'),
  };

  let hid = null; // the open HIDDevice
  let layout = null;
  let rows = {}; // field.key -> { fill, output } or LED element
  const latest = {}; // field.key -> raw value
  const sent = {}; // field.key -> last value mirrored to vJoy
  let lastRaw = null;
  let reportCount = 0;
  let renderQueued = false;

  const { hex } = window.HidLayout;

  function warn(text) {
    els.warning.textContent = text ?? '';
    els.warning.hidden = !text;
  }

  function allFields() {
    return layout ? layout.reports.flatMap((r) => r.fields) : [];
  }

  // ---- Device picker (fed by the main process's select-hid-device handler) ----

  window.hidChooser.onChoose((list) => {
    els.pickerList.replaceChildren();
    if (!list.length) {
      els.pickerList.innerHTML = '<li class="empty">No joysticks found. Is it plugged in?</li>';
    }
    for (const d of list) {
      const li = document.createElement('li');
      li.classList.toggle('thrustmaster', d.vendorId === THRUSTMASTER_VID);
      const b = document.createElement('button');
      b.textContent = d.name || 'Unnamed device';
      const ids = document.createElement('span');
      ids.textContent = `${hex(d.vendorId)}:${hex(d.productId)}`;
      b.append(ids);
      b.addEventListener('click', () => {
        els.picker.hidden = true;
        window.hidChooser.choose(d.deviceId);
      });
      li.append(b);
      els.pickerList.append(li);
    }
    els.picker.hidden = false;
  });

  els.pickerCancel.addEventListener('click', () => {
    els.picker.hidden = true;
    window.hidChooser.choose(null);
  });

  els.choose.addEventListener('click', async () => {
    warn(null);
    try {
      const [device] = await navigator.hid.requestDevice({ filters: JOYSTICK_FILTERS });
      if (device) await openDevice(device);
    } catch (err) {
      warn(`Could not open the joystick: ${err.message}`);
    }
  });

  navigator.hid.addEventListener('disconnect', (e) => {
    if (e.device === hid) warn('The joystick was disconnected.');
  });

  // ---- Opening and laying out a device ---------------------------------------

  async function openDevice(device) {
    if (hid) {
      hid.removeEventListener('inputreport', onReport);
      if (hid.opened) await hid.close();
    }
    hid = device;
    if (!hid.opened) await hid.open();
    hid.addEventListener('inputreport', onReport);

    els.name.textContent = `${hid.productName || 'Unnamed device'} (${hex(hid.vendorId)}:${hex(hid.productId)})`;
    els.save.disabled = false;
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
        `${f.bitSize} @ ${f.bitOffset}`,
        `${f.logicalMin}…${f.logicalMax}`,
        f.vjoy ?? '—',
      ];
      for (const text of cells) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      const live = document.createElement('td');
      live.className = 'live';
      live.innerHTML = '<div class="meter"><div class="bar"><div class="fill"></div></div><output>—</output></div>';
      tr.append(live);
      els.fields.append(tr);
      rows[f.key] = { fill: live.querySelector('.fill'), output: live.querySelector('output') };
    }
    if (!els.fields.children.length) {
      els.fields.innerHTML = '<tr><td colspan="6" class="empty">No axes or hats found.</td></tr>';
    }

    for (const f of fields.filter((x) => x.kind === 'button')) {
      const led = document.createElement('div');
      led.className = 'led';
      led.textContent = f.button;
      els.buttons.append(led);
      rows[f.key] = led;
    }
    if (!els.buttons.children.length) els.buttons.innerHTML = '<p class="empty">No buttons found.</p>';
  }

  function renderSetup() {
    const setup = window.HidLayout.vjoySetup(layout);
    const items = [
      ['Axes', setup.axes.join(', ') || 'none'],
      ['Buttons', String(setup.buttons)],
      ['POV hats', setup.contPovs ? `${setup.contPovs} × continuous` : 'none'],
    ];
    els.vjoy.replaceChildren(
      ...items.map(([label, value]) => {
        const li = document.createElement('li');
        li.innerHTML = `${label}: <b></b>`;
        li.querySelector('b').textContent = value;
        return li;
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
      warn(`Report ${e.reportId} is ${bytes.length} bytes but the layout expects ${Math.ceil(report.bitLength / 8)}. Values may be wrong.`);
    }

    Object.assign(latest, window.HidLayout.decode(report, bytes));
    if (els.mirror.checked) mirror(report);
    if (!renderQueued) {
      renderQueued = true;
      requestAnimationFrame(render);
    }
  }

  function mirror(report) {
    for (const f of report.fields) {
      if (!f.vjoy || !(f.key in latest) || sent[f.key] === latest[f.key]) continue;
      sent[f.key] = latest[f.key];
      const v = window.HidLayout.normalise(f, latest[f.key]);
      if (f.kind === 'axis') window.vjoy.setAxis(f.vjoy, v);
      else if (f.kind === 'button') window.vjoy.setButton(f.button, v !== 0);
      else if (f.kind === 'hat') window.vjoy.setPov(Number(f.vjoy.split(' ')[1]), v);
    }
  }

  els.mirror.addEventListener('change', () => {
    for (const k of Object.keys(sent)) delete sent[k];
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
        row.fill.style.width = angle < 0 ? '0%' : `${(angle / 360) * 100}%`;
        row.output.textContent = angle < 0 ? 'centre' : `${Math.round(angle)}°`;
      } else {
        const span = f.logicalMax - f.logicalMin;
        row.fill.style.width = `${span > 0 ? ((v - f.logicalMin) / span) * 100 : 0}%`;
        row.output.textContent = v;
      }
    }
    if (lastRaw) {
      const prefix = lastRaw.reportId ? `[${hex(lastRaw.reportId, 2)}] ` : '';
      els.raw.textContent = prefix + Array.from(lastRaw.bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
    }
  }

  setInterval(() => {
    els.rate.textContent = hid ? `${reportCount} reports/s` : '';
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
      els.name.textContent = `Saved to ${saved.filePath}. Copy this file to the other PC and use Load profile… there.`;
    } catch (err) {
      warn(`Could not save the profile: ${err.message}`);
    }
  });
})();
