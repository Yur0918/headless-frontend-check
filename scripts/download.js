#!/usr/bin/env node
'use strict';
/**
 * Verify that clicking something really produces a download.
 *
 * Many "export" bugs are invisible to DOM assertions: the button works, the
 * request succeeds, but the file never lands. This clicks a selector, waits
 * for a new file to appear in a temp directory, and reports what arrived.
 *
 * Usage:
 *   node scripts/download.js <url> <clickSelector> [downloadDir] [timeoutMs]
 *
 * Examples:
 *   node scripts/download.js http://localhost:3000 '#export'
 *   node scripts/download.js http://localhost:3000 '#export' /tmp/dl 30000
 *
 * Optional:
 *   DOWNLOAD_EXT   only count files with this extension (e.g. .zip)
 *   PRE_CLICK_MS   settle time before clicking (default 800)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib');

function newestFile(dir, ext) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => !ext || f.toLowerCase().endsWith(ext.toLowerCase()))
    // Ignore in-progress download artifacts (.crdownload / .part)
    .filter((f) => !/\.(crdownload|part|tmp)$/i.test(f))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] || null;
}

(async () => {
  const url = process.argv[2];
  const clickSelector = process.argv[3];
  const dir = process.argv[4] || fs.mkdtempSync(path.join(os.tmpdir(), 'hfc-dl-'));
  const timeoutMs = parseInt(process.argv[5] || '30000', 10);
  const ext = process.env.DOWNLOAD_EXT || '';

  if (!url || !clickSelector) {
    console.error('Usage: node scripts/download.js <url> <clickSelector> [downloadDir] [timeoutMs]');
    process.exit(1);
  }

  fs.mkdirSync(dir, { recursive: true });
  const checker = lib.makeChecker();

  const browser = await lib.launch();
  const page = await browser.newPage();
  const errors = lib.collectErrors(page);

  // Route downloads to our directory instead of the OS default location.
  const client = await page.createCDPSession();
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: dir,
    eventsEnabled: true,
  });

  await page.goto(url, { waitUntil: 'networkidle2' });
  await lib.sleep(parseInt(process.env.PRE_CLICK_MS || '800', 10));

  const exists = await page.$(clickSelector);
  checker.check('click target exists: ' + clickSelector, !!exists);
  if (!exists) {
    await browser.close();
    checker.finish();
    return;
  }

  await page.click(clickSelector);
  console.log('  (clicked ' + clickSelector + ', waiting for a file in ' + dir + ')');

  let found = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    found = newestFile(dir, ext);
    if (found) break;
    await lib.sleep(400);
  }

  checker.check('a file was downloaded', !!found, found ? found.name : 'nothing after ' + timeoutMs + 'ms');

  if (found) {
    const full = path.join(dir, found.name);
    const size = fs.statSync(full).size;
    checker.check('file is not empty', size > 0, size + ' bytes');
    if (ext) checker.check('file extension matches ' + ext, found.name.toLowerCase().endsWith(ext.toLowerCase()), found.name);
    console.log('  Downloaded: ' + full + ' (' + size + ' bytes)');
  }

  checker.check('no uncaught JS exceptions', errors.pageErrors.length === 0, errors.pageErrors.join(' | '));
  checker.check('no console errors', errors.consoleErrors.length === 0, errors.consoleErrors.join(' | '));

  await browser.close();
  checker.finish();
})().catch((e) => {
  console.error('download check failed:', e.message || e);
  process.exit(1);
});
