// Copies the web app into the Android app's assets, fonts included, so the
// APK needs no network and never contacts Google. Used by tools/build-apk.sh.
//
//   node tools/bundle-web.js <repo root> <assets dir>
//
const fs = require('fs');
const path = require('path');

const [root, assets] = process.argv.slice(2);

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (/fonts\.g(oogleapis|static)\.com/.test(html)) throw new Error('index.html still loads fonts from Google');

// sw.js precaches the fonts from its own FONT_FILES list. Fail the build if
// that list and fonts.css disagree, or the offline app would miss a font.
const fontsDir = path.join(root, 'fonts');
const css = fs.readFileSync(path.join(fontsDir, 'fonts.css'), 'utf8');
const used = new Set(['fonts/fonts.css', ...[...css.matchAll(/url\(([^)'"]+)\)/g)].map(m => 'fonts/' + m[1])]);
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const listBlock = (sw.match(/const FONT_FILES = \[([\s\S]*?)\];/) || [])[1];
if (!listBlock) throw new Error('FONT_FILES not found in sw.js');
const listed = new Set([...listBlock.matchAll(/'([^']+)'/g)].map(m => m[1]));
const missing = [...used].filter(f => !listed.has(f));
const extra = [...listed].filter(f => !used.has(f));
if (missing.length || extra.length) {
  throw new Error('sw.js FONT_FILES and fonts/fonts.css disagree. Missing: ' + missing.join(', ') + '. Extra: ' + extra.join(', '));
}
for (const f of used) {
  if (!fs.existsSync(path.join(root, f))) throw new Error('missing font file: ' + f);
}

fs.mkdirSync(path.join(assets, 'fonts'), { recursive: true });
['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'].forEach(f =>
  fs.copyFileSync(path.join(root, f), path.join(assets, f)));

// The stylesheet, the font files, and their licence texts (the font licences
// require the text to ship with the fonts).
const licences = fs.readdirSync(fontsDir).filter(f => f.endsWith('.txt')).map(f => 'fonts/' + f);
let files = 0;
for (const f of [...used, ...licences]) {
  fs.copyFileSync(path.join(root, f), path.join(assets, f));
  files++;
}
console.log('bundled web app with ' + files + ' files from fonts/');
