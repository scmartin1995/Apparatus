// A static server that caches like GitHub Pages, for exercising the service
// worker's update path by hand. Not used by the tests and not shipped.
//
//   node tools/pages-server.js [--port 8742] [--rev <git rev> | --dir <folder>]
//
// --rev serves the files of that commit straight out of git (so an old build
// needs no checkout); --dir serves a folder. The default is the working tree.
//
// Every file gets what GitHub Pages sends: Cache-Control: max-age=600, an ETag
// and a Last-Modified, and a 304 when the browser revalidates a file that has
// not changed. That ten-minute cache is the point: it is what the service
// worker's no-cache fetches have to see past.
//
// While it runs, GET /__pages changes what it serves, without a restart, so the
// browser keeps the same origin and the same installed worker:
//
//   /__pages                          show the current settings
//   /__pages?rev=main                 serve another build
//   /__pages?missing=fonts/fonts.css  answer 404 for these files (comma list)
//   /__pages?drop=*                   cut the connection, like no network
//                                     (comma list; * is every file but sw.js)
//   /__pages?delay=10000              hold every page load (index.html or the
//                                     bare folder) for this many ms
//
// An empty value clears a setting (missing=, drop=, delay=0). /__pages itself
// is never cached, never dropped and never delayed.
//
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };

const port = Number(arg('port') || 8742);
const settings = { rev: arg('rev') || null, dir: arg('dir') ? path.resolve(arg('dir')) : ROOT, missing: [], drop: [], delay: 0 };
// Pages stamps a file with the time it was deployed; a new build is a new deploy.
let deployedAt = new Date();

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// The bytes of one file of the build, or null if the build has no such file.
function readFile(rel) {
  if (settings.rev) {
    try {
      return execFileSync('git', ['show', settings.rev + ':' + rel], { cwd: ROOT, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      return null;
    }
  }
  const file = path.join(settings.dir, rel);
  if (!file.startsWith(settings.dir + path.sep)) return null;
  try { return fs.readFileSync(file); } catch (e) { return null; }
}

const list = value => value ? value.split(',').map(s => s.trim().replace(/^\/+/, '')).filter(Boolean) : [];
const matches = (patterns, rel) => patterns.some(p => p === rel || (p === '*' && rel !== 'sw.js'));

function control(url, res) {
  const q = url.searchParams;
  if (q.has('rev')) {
    const rev = q.get('rev');
    if (rev) execFileSync('git', ['rev-parse', '--verify', rev + '^{commit}'], { cwd: ROOT, stdio: 'ignore' });
    settings.rev = rev || null;
    deployedAt = new Date();
  }
  if (q.has('missing')) settings.missing = list(q.get('missing'));
  if (q.has('drop')) settings.drop = list(q.get('drop'));
  if (q.has('delay')) settings.delay = Number(q.get('delay')) || 0;
  const body = JSON.stringify({ ...settings, deployedAt: deployedAt.toUTCString() }, null, 2) + '\n';
  console.log('[pages] ' + body.replace(/\s+/g, ' '));
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__pages') {
    try { control(url, res); } catch (e) { res.writeHead(400, { 'Cache-Control': 'no-store' }); res.end(String(e.message) + '\n'); }
    return;
  }
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const page = rel.endsWith('index.html');
  const log = status => console.log('[pages] ' + req.method + ' ' + url.pathname + ' ' + status);

  if (matches(settings.drop, rel)) { log('dropped'); req.socket.destroy(); return; }
  if (matches(settings.missing, rel)) {
    log(404);
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'max-age=600' });
    res.end('Not found\n');
    return;
  }

  const send = () => {
    const body = readFile(rel);
    if (!body) {
      log(404);
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'max-age=600' });
      res.end('Not found\n');
      return;
    }
    const etag = '"' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 16) + '"';
    const headers = {
      'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream',
      'Cache-Control': 'max-age=600',
      'Expires': new Date(Date.now() + 600000).toUTCString(),
      'ETag': etag,
      'Last-Modified': deployedAt.toUTCString(),
      'Access-Control-Allow-Origin': '*',
    };
    if (req.headers['if-none-match'] === etag) {
      log(304);
      res.writeHead(304, headers);
      res.end();
      return;
    }
    log(200);
    res.writeHead(200, { ...headers, 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  if (page && settings.delay > 0) setTimeout(send, settings.delay); else send();
}).listen(port, () => {
  console.log('[pages] serving ' + (settings.rev ? 'git ' + settings.rev : settings.dir) + ' at http://localhost:' + port + '/');
});
