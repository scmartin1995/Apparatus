// Copies the web app into the Android app's assets with the Google fonts
// bundled, so the APK needs no network. Used by tools/build-apk.sh.
//
//   node tools/bundle-web.js <repo root> <assets dir> <font cache dir>
//
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const [root, assets, cache] = process.argv.slice(2);
// Google serves woff2 only to a browser-looking client.
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

// curl rather than Node's fetch: it honours the proxy settings of whatever
// machine the build runs on.
function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
  execFileSync('curl', ['-sS', '--fail', '--retry', '3', '-A', UA, '-o', file, url], { stdio: 'inherit' });
}
const short = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

fs.mkdirSync(path.join(assets, 'fonts'), { recursive: true });
fs.mkdirSync(cache, { recursive: true });

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sheets = [...new Set(html.match(/https:\/\/fonts\.googleapis\.com\/[^"']+/g) || [])];
if (!sheets.length) throw new Error('no font stylesheets found in index.html');

let files = 0;
sheets.forEach((sheet, i) => {
  const cssCache = path.join(cache, short(sheet) + '.css');
  download(sheet.replace(/&amp;/g, '&'), cssCache);
  let css = fs.readFileSync(cssCache, 'utf8');
  const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) || [])];
  if (!urls.length) throw new Error('no font files in ' + sheet);
  urls.forEach(u => {
    const name = short(u) + (path.extname(u.split('?')[0]) || '.woff2');
    download(u, path.join(cache, name));
    fs.copyFileSync(path.join(cache, name), path.join(assets, 'fonts', name));
    css = css.split(u).join(name);
    files++;
  });
  const local = 'fonts/fonts-' + i + '.css';
  fs.writeFileSync(path.join(assets, local), css);
  html = html.split(sheet).join(local);
});
if (/fonts\.g(oogleapis|static)\.com/.test(html)) throw new Error('a font link was not rewritten');

fs.writeFileSync(path.join(assets, 'index.html'), html);
fs.copyFileSync(path.join(root, 'manifest.json'), path.join(assets, 'manifest.json'));
['icon-192.png', 'icon-512.png'].forEach(f => fs.copyFileSync(path.join(root, f), path.join(assets, f)));
console.log('bundled web app with ' + sheets.length + ' stylesheets, ' + files + ' font files');
