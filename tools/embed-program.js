// Validates a program file and embeds it as the app's built-in program.
// The app is a single offline file, so the program has to be inlined; this keeps
// the inlined copy and the readable one from drifting.
//
//   node tools/embed-program.js                        # re-embed the active program
//   node tools/embed-program.js programs/other.json    # switch the built-in program
//
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const ACTIVE = 'programs/field-guide-ppl.json';
const START = 'const LOCKED_PROGRAM = ';
const END = ';\r\n\r\n// ── STATE';

// section.type drives session scoring, so a typo here silently mis-scores a
// session rather than failing loudly. Check it at author time instead.
const TYPES = ['warmup', 'primary', 'ar7', 'finisher', 'accessory'];

function validate(p, label) {
  const errs = [];
  if (!p.id) errs.push('missing id');
  if (!p.name) errs.push('missing name');
  if (!Array.isArray(p.days) || !p.days.length) errs.push('no days');
  const baselineIds = (p.baselines || []).map(b => b.id);

  (p.days || []).forEach(d => {
    const where = 'day "' + (d.id || '?') + '"';
    if (!d.id) errs.push(where + ': missing id');
    if (!d.sections) errs.push(where + ': missing sections');
    if (!d.isOff && !(d.sections || []).length) errs.push(where + ': training day with no sections');
    (d.sections || []).forEach(s => {
      const sw = where + ' / "' + (s.title || '?') + '"';
      if (TYPES.indexOf(s.type) === -1) errs.push(sw + ': bad type "' + s.type + '" (expected ' + TYPES.join(', ') + ')');
      if (!!s.ar7 !== (s.type === 'ar7')) errs.push(sw + ': ar7 flag disagrees with type');
      if (!(s.items || []).length) errs.push(sw + ': no items');
      (s.items || []).forEach(i => {
        if (!i.name) errs.push(sw + ': item with no name');
        if (!i.sets) errs.push(sw + ' / "' + i.name + '": no sets');
        if (i.baselineId && baselineIds.indexOf(i.baselineId) === -1) {
          errs.push(sw + ' / "' + i.name + '": baselineId "' + i.baselineId + '" has no matching baseline');
        }
        // A bound item gets its load appended live, so a literal one would double up.
        if (i.baselineId && i.sets.indexOf('@') !== -1) {
          errs.push(sw + ' / "' + i.name + '": bound to a baseline but sets still carries a fixed load');
        }
      });
    });
  });

  const map = p.weekdayMap;
  if (map) {
    if (!Array.isArray(map) || map.length !== 7) errs.push('weekdayMap must have 7 entries (Sun-first)');
    else map.forEach((id, i) => {
      if (!p.days.some(d => d.id === id)) errs.push('weekdayMap[' + i + '] = "' + id + '" matches no day');
    });
  }

  const unused = baselineIds.filter(id =>
    !p.days.some(d => (d.sections || []).some(s => (s.items || []).some(i => i.baselineId === id))));
  if (errs.length) {
    console.error('invalid program (' + label + '):');
    errs.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }
  return { unused };
}

const rel = process.argv[2] || ACTIVE;
const jsonPath = path.resolve(ROOT, rel);
const program = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
if (JSON.stringify(program).indexOf('</') !== -1) throw new Error('program JSON contains a script-closing sequence');

const { unused } = validate(program, rel);

let src = fs.readFileSync(HTML, 'utf8');
const from = src.indexOf(START);
const to = src.indexOf(END, from);
if (from === -1 || to === -1) throw new Error('LOCKED_PROGRAM block not found in index.html');

const body = JSON.stringify(program, null, 2).split('\n').join('\r\n');
const next = src.slice(0, from) + START + body + src.slice(to);

const days = program.days.filter(d => !d.isOff).length;
const items = program.days.reduce((a, d) => a + d.sections.reduce((x, s) => x + s.items.length, 0), 0);
const bound = program.days.flatMap(d => d.sections).flatMap(s => s.items).filter(i => i.baselineId).length;

if (next === src) {
  console.log(program.name + ' already in sync');
} else {
  fs.writeFileSync(HTML, next);
  console.log('embedded ' + program.name + ' from ' + rel);
}
console.log('  ' + days + ' training days, ' + items + ' exercises, ' + bound + ' bound to a 1RM');
if (unused.length) console.log('  note: baselines with no exercise: ' + unused.join(', '));
