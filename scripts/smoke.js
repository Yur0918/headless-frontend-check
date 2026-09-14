#!/usr/bin/env node
'use strict';
/**
 * npm test entrypoint: run the end-to-end smoke checks against the bundled
 * examples/ fixture, fully self-contained (no python, no fixed ports).
 *
 *   1. serve examples/ over http on an ephemeral loopback port
 *   2. run-check.js  smoke + screenshot + runtime-error report
 *   3. assert.js     config-driven DOM assertions
 *
 * Exits non-zero if either check fails. Cross-platform, zero extra deps.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EXAMPLES = path.join(ROOT, 'examples');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

/** Minimal static file server for examples/, loopback only. */
function createStaticServer() {
  return http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = path.normalize(urlPath).replace(/^[/\\]+/, '');
    const file = path.join(EXAMPLES, rel === '' || rel === '.' ? 'smoke.html' : rel);
    if (file !== EXAMPLES && !file.startsWith(EXAMPLES + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      });
      res.end(data);
    });
  });
}

function run(label, args) {
  console.log(`\n--- ${label} ---`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('error', (e) => {
      console.error(`${label}: failed to spawn: ${e.message}`);
      resolve(false);
    });
    child.on('close', (code) => resolve(code === 0));
  });
}

(async () => {
  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`smoke server: ${base} -> ${EXAMPLES}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hfc-smoke-'));
  const results = [];

  try {
    results.push(
      await run('run-check.js (smoke + screenshot)', [
        path.join(__dirname, 'run-check.js'),
        `${base}/smoke.html`,
        path.join(tmp, 'smoke.png'),
      ])
    );

    // Same assertions as examples/smoke-config.json, pointed at this run's port.
    const cfg = JSON.parse(fs.readFileSync(path.join(EXAMPLES, 'smoke-config.json'), 'utf8'));
    cfg.url = cfg.url.replace(/^https?:\/\/[^/]+/, base);
    const cfgPath = path.join(tmp, 'smoke-config.json');
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    results.push(await run('assert.js (DOM assertions)', [path.join(__dirname, 'assert.js'), cfgPath]));
  } finally {
    server.close();
  }

  const failed = results.filter((ok) => !ok).length;
  console.log('\n================ smoke summary ================');
  console.log(`checks run: ${results.length}, failed: ${failed}`);
  console.log(`artifacts:  ${tmp}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('smoke runner failed:', e.message || e);
  process.exit(1);
});
