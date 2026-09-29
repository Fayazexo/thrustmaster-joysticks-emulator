// Turns a WebHID device's parsed collections into a flat list of input fields with
// bit offsets, and decodes raw input reports with it.
//
// WebHID groups report items by the collection they were declared in, not by their
// position in the report. When one report spans nested collections, the true order
// is ambiguous, so buildLayout() takes an `order` hint ('parent-first' or
// 'children-first') and flags such reports so the UI can offer the alternative.

(function (root) {
  const AXIS_NAMES = {
    0x10030: 'X', 0x10031: 'Y', 0x10032: 'Z',
    0x10033: 'Rx', 0x10034: 'Ry', 0x10035: 'Rz',
    0x10036: 'Slider', 0x10037: 'Dial', 0x10038: 'Wheel',
    0x200ba: 'Rudder', 0x200bb: 'Throttle', 0x200c4: 'Accelerator', 0x200c5: 'Brake',
  };
  const HAT_USAGE = 0x10039;
  const BUTTON_PAGE = 0x09;

  // Where each HID axis should land on vJoy, in order of preference.
  const VJOY_AXES = ['X', 'Y', 'Z', 'Rx', 'Ry', 'Rz', 'Slider0', 'Slider1'];
  const VJOY_PREFERENCE = {
    X: ['X'], Y: ['Y'], Z: ['Z'], Rx: ['Rx'], Ry: ['Ry'], Rz: ['Rz'],
    Rudder: ['Rz', 'Slider0', 'Slider1'],
  };
  const VJOY_FALLBACK = ['Slider0', 'Slider1', 'Z', 'Rx', 'Ry', 'Rz'];

  function hex(n, width = 4) {
    return '0x' + n.toString(16).toUpperCase().padStart(width, '0');
  }

  function classify(usage, item) {
    const page = usage >>> 16;
    const id = usage & 0xffff;
    if (item.isConstant) return { kind: 'padding', name: 'padding' };
    if (item.isArray) {
      return { kind: 'other', name: `Array ${hex(page, 2)}:${hex(id, 2)}` };
    }
    if (page === BUTTON_PAGE) return { kind: 'button', name: `Button ${id}`, button: id };
    if (usage === HAT_USAGE) return { kind: 'hat', name: 'Hat' };
    if (AXIS_NAMES[usage]) return { kind: 'axis', name: AXIS_NAMES[usage] };
    return { kind: 'other', name: `Usage ${hex(page, 2)}:${hex(id, 2)}` };
  }

  function itemUsage(item, i) {
    if (item.isRange) return Math.min(item.usageMinimum + i, item.usageMaximum);
    const usages = item.usages ?? [];
    return usages[Math.min(i, usages.length - 1)] ?? 0;
  }

  // Collects each report's items as ordered segments (one per collection).
  function collectSegments(collections, order, out = new Map()) {
    for (const c of collections ?? []) {
      const own = () => {
        for (const r of c.inputReports ?? []) {
          if (!out.has(r.reportId)) out.set(r.reportId, []);
          out.get(r.reportId).push(r.items ?? []);
        }
      };
      if (order === 'children-first') { collectSegments(c.children, order, out); own(); }
      else { own(); collectSegments(c.children, order, out); }
    }
    return out;
  }

  function buildLayout(collections, order = 'parent-first') {
    const reports = [];
    for (const [reportId, segments] of collectSegments(collections, order)) {
      const fields = [];
      let bit = 0;
      for (const item of segments.flat()) {
        for (let i = 0; i < item.reportCount; i++) {
          const usage = itemUsage(item, i);
          fields.push({
            key: `${reportId}:${fields.length}`,
            ...classify(usage, item),
            usage,
            bitOffset: bit,
            bitSize: item.reportSize,
            logicalMin: item.logicalMinimum,
            logicalMax: item.logicalMaximum,
          });
          bit += item.reportSize;
        }
      }
      reports.push({
        reportId,
        bitLength: bit,
        spansCollections: segments.filter((s) => s.length).length > 1,
        fields,
      });
    }

    // Name duplicates ("Slider", "Slider") so each field is distinguishable.
    const seen = {};
    for (const f of reports.flatMap((r) => r.fields)) {
      if (f.kind === 'axis' || f.kind === 'hat') {
        seen[f.name] = (seen[f.name] ?? 0) + 1;
        if (seen[f.name] > 1) f.name = `${f.name} ${seen[f.name]}`;
      }
    }

    assignVjoy(reports);
    return { order, reports };
  }

  function assignVjoy(reports) {
    const fields = reports.flatMap((r) => r.fields);
    const used = new Set();
    const axes = fields.filter((f) => f.kind === 'axis');
    const take = (f, candidates) => {
      const pick = candidates.find((c) => !used.has(c));
      if (pick) { used.add(pick); f.vjoy = pick; }
    };
    // Direct matches first, so e.g. a throttle can't steal Rz from a real Rz.
    for (const f of axes) if (VJOY_AXES.includes(f.name)) take(f, [f.name]);
    for (const f of axes) if (!f.vjoy) take(f, VJOY_PREFERENCE[f.name.split(' ')[0]] ?? VJOY_FALLBACK);
    for (const f of axes) if (!f.vjoy) take(f, VJOY_AXES);

    let pov = 0;
    for (const f of fields) if (f.kind === 'hat' && pov < 4) f.vjoy = `POV ${++pov}`;
    for (const f of fields) if (f.kind === 'button' && f.button <= 128) f.vjoy = `Button ${f.button}`;
  }

  function vjoySetup(layout) {
    const fields = layout.reports.flatMap((r) => r.fields);
    const axes = fields.filter((f) => f.kind === 'axis' && f.vjoy).map((f) => f.vjoy);
    return {
      axes: VJOY_AXES.filter((a) => axes.includes(a)),
      buttons: Math.max(0, ...fields.filter((f) => f.vjoy?.startsWith('Button')).map((f) => f.button)),
      contPovs: fields.filter((f) => f.vjoy?.startsWith('POV')).length,
    };
  }

  function readBits(bytes, bitOffset, bitSize) {
    let value = 0;
    for (let i = 0; i < bitSize; i++) {
      const bit = bitOffset + i;
      const byte = bit >> 3;
      if (byte >= bytes.length) return null;
      if (bytes[byte] & (1 << (bit & 7))) value += 2 ** i;
    }
    return value;
  }

  // Returns { [field.key]: value } for one report. `bytes` excludes the report ID.
  function decode(report, bytes) {
    const values = {};
    for (const f of report.fields) {
      if (f.kind === 'padding') continue;
      let v = readBits(bytes, f.bitOffset, f.bitSize);
      if (v === null) continue;
      if (f.logicalMin < 0 && v >= 2 ** (f.bitSize - 1)) v -= 2 ** f.bitSize;
      values[f.key] = v;
    }
    return values;
  }

  // 0..1 for axes; degrees clockwise from north (or -1 centred) for hats.
  function normalise(f, v) {
    if (f.kind === 'axis') {
      const span = f.logicalMax - f.logicalMin;
      return span > 0 ? Math.min(1, Math.max(0, (v - f.logicalMin) / span)) : 0;
    }
    if (f.kind === 'hat') {
      if (v < f.logicalMin || v > f.logicalMax) return -1;
      return ((v - f.logicalMin) * 360) / (f.logicalMax - f.logicalMin + 1);
    }
    return v;
  }

  // WebHID objects aren't plain JSON; copy the parts worth keeping in a profile.
  const ITEM_KEYS = [
    'isAbsolute', 'isArray', 'isBufferedBytes', 'isConstant', 'isLinear', 'isRange', 'isVolatile',
    'hasNull', 'hasPreferredState', 'wrap', 'usages', 'usageMinimum', 'usageMaximum',
    'reportSize', 'reportCount', 'logicalMinimum', 'logicalMaximum', 'physicalMinimum',
    'physicalMaximum', 'unitExponent', 'unitSystem',
  ];

  function serialiseCollections(collections) {
    const reportsOf = (list) => (list ?? []).map((r) => ({
      reportId: r.reportId,
      items: (r.items ?? []).map((it) => Object.fromEntries(ITEM_KEYS.map((k) => [k, it[k]]))),
    }));
    return (collections ?? []).map((c) => ({
      usagePage: c.usagePage,
      usage: c.usage,
      type: c.type,
      inputReports: reportsOf(c.inputReports),
      outputReports: reportsOf(c.outputReports),
      featureReports: reportsOf(c.featureReports),
      children: serialiseCollections(c.children),
    }));
  }

  const api = { buildLayout, vjoySetup, decode, normalise, serialiseCollections, hex };
  if (typeof module !== 'undefined') module.exports = api;
  else root.HidLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
