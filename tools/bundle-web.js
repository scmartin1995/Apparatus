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

fs.mkdirSync(path.join(assets, 'fonts'), { recursive: true });
['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'].forEach(f =>
  fs.copyFileSync(path.join(root, f), path.join(assets, f)));

let files = 0;
fs.readdirSync(path.join(root, 'fonts')).forEach(f => {
  fs.copyFileSync(path.join(root, 'fonts', f), path.join(assets, 'fonts', f));
  files++;
});
console.log('bundled web app with ' + files + ' files from fonts/');
