// Checks that sw.js FONT_FILES matches what fonts/fonts.css uses, and that
// every listed file exists. A mismatch means the offline app misses a font.
// Run it after changing any font:   node tools/check-fonts.js
// tools/bundle-web.js runs it too, so the APK build fails on a mismatch.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function checkFonts(root) {
  const css = fs.readFileSync(path.join(root, 'fonts', 'fonts.css'), 'utf8');
  // url(x), url('x') or url("x"); a ?query or #fragment is not part of the file name.
  const used = new Set(['fonts/fonts.css',
    ...[...css.matchAll(/url\(\s*['"]?([^)'"]+?)['"]?\s*\)/g)].map(m => {
      const ref = m[1].split(/[?#]/)[0];
      // Only relative paths inside fonts/ are served by the app itself.
      if (/^([a-z][a-z0-9+.-]*:|\/)/i.test(ref)) throw new Error('fonts.css must use relative font paths: ' + ref);
      const f = path.posix.normalize(path.posix.join('fonts', ref));
      if (!f.startsWith('fonts/')) throw new Error('fonts.css points outside fonts/: ' + ref);
      return f;
    })]);
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const block = (sw.match(/const FONT_FILES = \[([\s\S]*?)\];/) || [])[1];
  if (!block) throw new Error('FONT_FILES not found in sw.js');
  const listed = new Set([...block.matchAll(/'([^']+)'/g)].map(m => m[1]));
  const missing = [...used].filter(f => !listed.has(f));
  const extra = [...listed].filter(f => !used.has(f));
  if (missing.length || extra.length) {
    throw new Error('sw.js FONT_FILES and fonts/fonts.css disagree. Missing from FONT_FILES: ' +
      (missing.join(', ') || 'none') + '. Not used by fonts.css: ' + (extra.join(', ') || 'none'));
  }
  // Every font file the install requires must be one the app ships.
  const req = (sw.match(/const REQUIRED = \[([\s\S]*?)\];/) || [])[1];
  if (!req) throw new Error('REQUIRED not found in sw.js');
  const badReq = [...req.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(f => f.startsWith('fonts/') && !listed.has(f));
  if (badReq.length) throw new Error('sw.js REQUIRED names fonts not in FONT_FILES: ' + badReq.join(', '));
  // The install needs the icon font, found by its name in FONT_FILES.
  if (![...listed].some(f => f.startsWith('fonts/material-symbols-outlined.'))) {
    throw new Error('sw.js FONT_FILES has no fonts/material-symbols-outlined.* file');
  }
  for (const f of used) {
    if (!fs.statSync(path.join(root, f), { throwIfNoEntry: false })?.isFile()) throw new Error('missing font file: ' + f);
    // Font file names carry the first 8 hex digits of their SHA-256, so the
    // service worker can reuse a file by name across versions. A changed font
    // must get a new name.
    if (f.endsWith('.woff2')) {
      const m = f.match(/\.([0-9a-f]{8})\.woff2$/);
      const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex').slice(0, 8);
      if (!m || m[1] !== hash) throw new Error('font file name must end .' + hash + '.woff2: ' + f);
    }
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  if (/fonts\.g(oogleapis|static)\.com/.test(html)) throw new Error('index.html still loads fonts from Google');
  if (!/<link href="fonts\/fonts\.css" rel="stylesheet"\/?>/.test(html)) throw new Error('index.html does not link fonts/fonts.css');
  return [...used];
}

module.exports = { checkFonts };

if (require.main === module) {
  const files = checkFonts(process.argv[2] || path.join(__dirname, '..'));
  console.log('fonts OK: ' + files.length + ' files');
}
