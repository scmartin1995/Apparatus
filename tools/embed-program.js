// Validates the built-in programs and embeds them into index.html.
// The app is a single offline file, so the programs have to be inlined; this
// keeps the inlined copies and the readable ones from drifting.
//
//   node tools/embed-program.js                  # embed everything in programs/index.json
//   node tools/embed-program.js a.json b.json    # embed just these, in this order
//
// programs/index.json is an ordered list of filenames. The first one is the
// app's default; the rest are selectable on the Import screen.
//
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const DIR = path.join(ROOT, 'programs');
const START = 'const BUILT_IN_PROGRAMS = ';
const END = ';\r\n\r\n// ── STATE';

// section.type drives session scoring, so a typo here silently mis-scores a
// session rather than failing loudly. Check it at author time instead.
const TYPES = ['warmup', 'primary', 'ar7', 'finisher', 'accessory'];

function validate(p, label, errs) {
  const at = m => errs.push(label + ': ' + m);
  if (!p.id) at('missing id');
  if (!p.name) at('missing name');
  if (!Array.isArray(p.days) || !p.days.length) at('no days');
  const baselineIds = (p.baselines || []).map(b => b.id);

  (p.days || []).forEach(d => {
    const dw = 'day "' + (d.id || '?') + '"';
    if (!d.id) at(dw + ': missing id');
    if (!d.sections) at(dw + ': missing sections');
    if (!d.isOff && !(d.sections || []).length) at(dw + ': training day with no sections');
    (d.sections || []).forEach(s => {
      const sw = dw + ' / "' + (s.title || '?') + '"';
      if (TYPES.indexOf(s.type) === -1) at(sw + ': bad type "' + s.type + '" (expected ' + TYPES.join(', ') + ')');
      if (!!s.ar7 !== (s.type === 'ar7')) at(sw + ': ar7 flag disagrees with type');
      if (!(s.items || []).length) at(sw + ': no items');
      (s.items || []).forEach(i => {
        const iw = sw + ' / "' + (i.name || '?') + '"';
        if (!i.name) at(sw + ': item with no name');
        if (!i.sets) at(iw + ': no sets');
        if (i.baselineId && baselineIds.indexOf(i.baselineId) === -1) at(iw + ': baselineId "' + i.baselineId + '" has no matching baseline');
        // A bound item gets its load appended live, so a literal one doubles up.
        if (i.baselineId && i.sets.indexOf('@') !== -1) at(iw + ': bound to a baseline but sets still carries a fixed load');
      });
    });
  });

  if (p.weekdayMap) {
    if (!Array.isArray(p.weekdayMap) || p.weekdayMap.length !== 7) at('weekdayMap must have 7 entries (Sun-first)');
    else p.weekdayMap.forEach((id, i) => {
      if (!p.days.some(d => d.id === id)) at('weekdayMap[' + i + '] = "' + id + '" matches no day');
    });
  }

  return baselineIds.filter(id =>
    !p.days.some(d => (d.sections || []).some(s => (s.items || []).some(i => i.baselineId === id))));
}

const files = process.argv.length > 2
  ? process.argv.slice(2).map(f => path.basename(f))
  : JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));

const errs = [];
const programs = files.map(f => {
  const p = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  p._unused = validate(p, f, errs);
  return p;
});

// Baseline overrides are stored per program id, so a duplicate would let two
// programs quietly share one set of 1RMs.
const seen = {};
programs.forEach((p, i) => {
  if (seen[p.id]) errs.push(files[i] + ': duplicate id "' + p.id + '" (also in ' + seen[p.id] + ')');
  seen[p.id] = files[i];
});

if (errs.length) {
  console.error('invalid program data:');
  errs.forEach(e => console.error('  - ' + e));
  process.exit(1);
}

const clean = programs.map(p => { const c = Object.assign({}, p); delete c._unused; return c; });
if (JSON.stringify(clean).indexOf('</') !== -1) throw new Error('program data contains a script-closing sequence');

let src = fs.readFileSync(HTML, 'utf8');
const from = src.indexOf(START);
const to = src.indexOf(END, from);
if (from === -1 || to === -1) throw new Error('BUILT_IN_PROGRAMS block not found in index.html');

const body = JSON.stringify(clean, null, 2).split('\n').join('\r\n');
const next = src.slice(0, from) + START + body + src.slice(to);

if (next === src) console.log('already in sync');
else { fs.writeFileSync(HTML, next); console.log('embedded ' + programs.length + ' program' + (programs.length !== 1 ? 's' : '') + ':'); }

programs.forEach((p, i) => {
  const days = p.days.filter(d => !d.isOff).length;
  const items = p.days.reduce((a, d) => a + d.sections.reduce((x, s) => x + s.items.length, 0), 0);
  console.log('  ' + (i === 0 ? '*' : ' ') + ' ' + p.name + ' — ' + days + ' days, ' + items + ' exercises' + (i === 0 ? '  (default)' : ''));
  if (p._unused.length) console.log('      note: baselines with no exercise: ' + p._unused.join(', '));
});
