// Syncs programs/ar7-hybrid.json into the LOCKED_PROGRAM block in index.html.
// The app is a single offline file, so the program has to be inlined; this keeps
// the inlined copy and the readable one from drifting. Run after editing the JSON:
//
//   node tools/embed-program.js
//
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const JSON_PATH = path.join(ROOT, 'programs', 'ar7-hybrid.json');
const START = 'const LOCKED_PROGRAM = ';
const END = ';\r\n\r\n// ── STATE';

const program = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
if (JSON.stringify(program).indexOf('</') !== -1) {
  throw new Error('program JSON contains a script-closing sequence');
}

let src = fs.readFileSync(HTML, 'utf8');
const from = src.indexOf(START);
const to = src.indexOf(END, from);
if (from === -1 || to === -1) throw new Error('LOCKED_PROGRAM block not found in index.html');

const body = JSON.stringify(program, null, 2).split('\n').join('\r\n');
const next = src.slice(0, from) + START + body + src.slice(to);
if (next === src) { console.log('already in sync'); process.exit(0); }

fs.writeFileSync(HTML, next);
const items = program.days.reduce((a, d) => a + d.sections.reduce((x, s) => x + s.items.length, 0), 0);
console.log('embedded ' + program.name + ': ' + program.days.length + ' days, ' + items + ' exercises, ' + program.baselines.length + ' baselines');
