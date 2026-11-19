// Copies the web app into the Android app's assets, fonts included, so the
// APK needs no network and never contacts Google. Used by tools/build-apk.sh.
//
//   node tools/bundle-web.js <repo root> <assets dir>
//
const fs = require('fs');
const path = require('path');
const { checkFonts } = require('./check-fonts');

const [root, assets] = process.argv.slice(2);

// Fails the build if index.html loads Google fonts or sw.js FONT_FILES and
// fonts/fonts.css disagree.
const used = checkFonts(root);

fs.mkdirSync(path.join(assets, 'fonts'), { recursive: true });
['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'].forEach(f =>
  fs.copyFileSync(path.join(root, f), path.join(assets, f)));

// The stylesheet, the font files, and their licence texts (the font licences
// require the text to ship with the fonts).
const licences = fs.readdirSync(path.join(root, 'fonts')).filter(f => f.endsWith('.txt')).map(f => 'fonts/' + f);
let files = 0;
for (const f of [...used, ...licences]) {
  fs.copyFileSync(path.join(root, f), path.join(assets, f));
  files++;
}
console.log('bundled web app with ' + files + ' files from fonts/');
