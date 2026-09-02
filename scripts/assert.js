#!/usr/bin/env node
'use strict';
/**
 * Config-driven DOM assertions against a local page.
 *
 * Usage:
 *   node scripts/assert.js <config.json>
 *
 * Config format:
 * {
 *   "url": "http://localhost:3000",
 *   "waitMs": 1200,                     // optional settle time after load
 *   "screenshot": "/tmp/shot.png",      // optional
 *   "assertions": [
 *     { "type": "title",   "contains": "My App" },
 *     { "type": "visible", "selector": "#drop" },
 *     { "type": "hidden",  "selector": "#batchbar" },
 *     { "type": "text",    "selector": ".job-name", "contains": "报告.docx" },
 *     { "type": "count",   "selector": "#jobs .job", "equals": 3 },
 *     { "type": "count",   "selector": "#jobs .job", "min": 1 },
 *     { "type": "disabled","selector": "#submit", "equals": false },
 *     { "type": "class",   "selector": "#modal", "has": "show" },
 *     { "type": "attr",    "selector": "img", "name": "src", "contains": ".png" }
 *   ]
 * }
 *
 * Every run also asserts "no uncaught exceptions" and "no console errors",
 * which is where most regressions actually show up.
 */
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

async function runAssertion(page, a) {
  switch (a.type) {
    case 'title':
      return { actual: await page.title(), ok: await page.title().then((t) => t.includes(a.contains)) };
    case 'visible':
      return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { actual: 'element not found', ok: false };
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          actual: 'display=' + cs.display + ' size=' + Math.round(r.width) + 'x' + Math.round(r.height),
          ok: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
        };
      }, a.selector);
    case 'hidden':
      return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { actual: 'element not found', ok: false };
        const cs = getComputedStyle(el);
        return { actual: 'display=' + cs.display, ok: cs.display === 'none' || cs.visibility === 'hidden' };
      }, a.selector);
    case 'text':
      return page.evaluate((sel, needle) => {
        const el = document.querySelector(sel);
        if (!el) return { actual: 'element not found', ok: false };
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return { actual: t, ok: t.includes(needle) };
      }, a.selector, a.contains);
    case 'count':
      return page.evaluate((sel) => document.querySelectorAll(sel).length, a.selector).then((n) => {
        let ok = true;
        if (typeof a.equals === 'number') ok = n === a.equals;
        else if (typeof a.min === 'number') ok = n >= a.min;
        else if (typeof a.max === 'number') ok = n <= a.max;
        return { actual: 'count=' + n, ok };
      });
    case 'disabled':
      return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { actual: 'element not found', ok: false };
        return { actual: 'disabled=' + el.disabled, ok: el.disabled === true };
      }, a.selector).then((r) => {
        const ok = a.equals === undefined ? r.ok : (r.actual === 'disabled=' + a.equals);
        return { actual: r.actual, ok };
      });
    case 'class':
      return page.evaluate((sel, cls) => {
        const el = document.querySelector(sel);
        if (!el) return { actual: 'element not found', ok: false };
        return { actual: 'class="' + el.className + '"', ok: el.classList.contains(cls) };
      }, a.selector, a.has);
    case 'attr':
      return page.evaluate((sel, name) => {
        const el = document.querySelector(sel);
        if (!el) return { actual: 'element not found', ok: false };
        return { actual: String(el.getAttribute(name)), ok: true };
      }, a.selector, a.name).then((r) => ({
        actual: r.actual,
        ok: r.ok && r.actual.includes(a.contains || ''),
      }));
    default:
      return { actual: 'unknown assertion type: ' + a.type, ok: false };
  }
}

(async () => {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error('Usage: node scripts/assert.js <config.json>');
    console.error('See examples/assert-config.json for the format.');
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const checker = lib.makeChecker();

  const browser = await lib.launch();
  const page = await browser.newPage();
  const errors = lib.collectErrors(page);

  await page.goto(config.url, { waitUntil: 'networkidle2' });
  await lib.sleep(config.waitMs || 1200);

  for (const a of config.assertions || []) {
    let res;
    try {
      res = await runAssertion(page, a);
    } catch (e) {
      res = { actual: 'threw: ' + e.message, ok: false };
    }
    const label = a.type + ' ' + (a.selector ? a.selector : a.contains ? '"' + a.contains + '"' : '');
    checker.check(label, res.ok, res.ok ? undefined : res.actual);
  }

  if (config.screenshot) {
    fs.mkdirSync(path.dirname(config.screenshot), { recursive: true });
    await page.screenshot({ path: config.screenshot, fullPage: true });
    console.log('\nScreenshot: ' + config.screenshot);
  }

  checker.check('no uncaught JS exceptions', errors.pageErrors.length === 0, errors.pageErrors.join(' | '));
  checker.check('no console errors', errors.consoleErrors.length === 0, errors.consoleErrors.join(' | '));

  await browser.close();
  checker.finish();
})().catch((e) => {
  console.error('assert failed:', e.message || e);
  process.exit(1);
});
