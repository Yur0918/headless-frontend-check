#!/usr/bin/env node
'use strict';
/**
 * Smoke check: load a page, report the title, capture runtime errors,
 * save a full-page screenshot.
 *
 * Usage:
 *   node scripts/run-check.js <url> [screenshot-path]
 *
 * Examples:
 *   node scripts/run-check.js http://localhost:3000
 *   node scripts/run-check.js http://localhost:3000 /tmp/home.png
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib');

(async () => {
  const url = process.argv[2] || 'http://localhost:3000/';
  const screenshotPath =
    process.argv[3] || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hfc-')), 'screenshot.png');

  const browser = await lib.launch();
  const page = await browser.newPage();
  const errors = lib.collectErrors(page);

  await page.goto(url, { waitUntil: 'networkidle2' });
  await lib.sleep(1200);

  const title = await page.evaluate(() => document.title);
  const bodyText = await page.evaluate(() => (document.body.innerText || '').slice(0, 200));

  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  console.log('URL:        ' + url);
  console.log('Title:      ' + title);
  console.log('Screenshot: ' + screenshotPath);
  console.log('Body head:  ' + JSON.stringify(bodyText.replace(/\s+/g, ' ').trim().slice(0, 120)));

  const all = errors.all();
  if (all.length) {
    console.log('\nRuntime errors (' + all.length + '):');
    all.forEach((e) => console.log('  - ' + e));
  } else {
    console.log('\nRuntime errors: none');
  }

  await browser.close();
  process.exitCode = all.length ? 1 : 0;
})().catch((e) => {
  console.error('run-check failed:', e.message || e);
  process.exit(1);
});
