// Checks that sw.js FONT_FILES matches what fonts/fonts.css uses, and that
// every listed file exists. A mismatch means the offline app misses a font.
// Run it after changing any font:   node tools/check-fonts.js
// tools/bundle-web.js runs it too, so the APK build fails on a mismatch.
const fs = require('fs');
const path = require('path');

function checkFonts(root) {
  const css = fs.readFileSync(path.join(root, 'fonts', 'fonts.css'), 'utf8');
  const used = new Set(['fonts/fonts.css', ...[...css.matchAll(/url\(([^)'"]+)\)/g)].map(m => 'fonts/' + m[1])]);
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
  for (const f of used) {
    if (!fs.statSync(path.join(root, f), { throwIfNoEntry: false })?.isFile()) throw new Error('missing font file: ' + f);
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  if (/fonts\.g(oogleapis|static)\.com/.test(html)) throw new Error('index.html still loads fonts from Google');
  return [...used];
}

module.exports = { checkFonts };

if (require.main === module) {
  const files = checkFonts(process.argv[2] || path.join(__dirname, '..'));
  console.log('fonts OK: ' + files.length + ' files');
}
