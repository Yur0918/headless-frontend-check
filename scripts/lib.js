'use strict';
/**
 * Shared helpers for headless Chrome checks.
 *
 * Keeps the boilerplate (locating Chrome, launching with the right flags,
 * collecting runtime errors, recording assertions) in one place so each
 * check script stays short and readable.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

/** Platform-specific Chrome/Chromium locations. Override with env vars. */
function chromeCandidates() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const map = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ],
    win32: [
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
  };
  return map[process.platform] || [];
}

/**
 * Locate a usable Chrome/Chromium binary.
 * Priority: PUPPETEER_EXECUTABLE_PATH > CHROME_PATH > well-known platform paths.
 */
function findChrome() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (envPath) {
    if (fs.existsSync(envPath)) return envPath;
    throw new Error(
      'Chrome path was provided via PUPPETEER_EXECUTABLE_PATH/CHROME_PATH but does not exist: ' + envPath
    );
  }
  for (const candidate of chromeCandidates()) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'Could not find Chrome/Chromium on this machine.\n' +
      'Set PUPPETEER_EXECUTABLE_PATH (or CHROME_PATH) to the browser binary.\n' +
      'Tried: ' + (chromeCandidates().join(', ') || '(none for platform ' + process.platform + ')')
  );
}

/**
 * Launch headless Chrome. `--no-sandbox` is required inside containers/CI
 * and when running as root; harmless on a normal desktop.
 */
function launch(options) {
  options = options || {};
  return puppeteer.launch({
    headless: true,
    executablePath: options.executablePath || findChrome(),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: options.viewport || { width: 1280, height: 900 },
  });
}

/**
 * Attach the standard error listeners and return a collector.
 * Covers three failure modes that are easy to miss:
 *   - pageerror:   uncaught exceptions
 *   - console:     console.error / failed resource loads
 *   - dialog:      alert/confirm/prompt (auto-accepted, but recorded)
 */
function collectErrors(page) {
  const pageErrors = [];
  const consoleErrors = [];

  page.on('pageerror', (err) => pageErrors.push(String((err && err.message) || err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('dialog', async (d) => {
    consoleErrors.push('[dialog] ' + d.message());
    await d.accept();
  });

  return {
    pageErrors,
    consoleErrors,
    all: () => pageErrors.concat(consoleErrors),
  };
}

/** Tiny assertion recorder: prints each result and tallies at the end. */
function makeChecker() {
  const results = [];
  return {
    results,
    check(name, pass, detail) {
      results.push({ name, pass: !!pass, detail });
      console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  -> ' + detail : ''));
      return !!pass;
    },
    /** Prints a summary and exits non-zero when anything failed. */
    finish(silent) {
      const failed = results.filter((r) => !r.pass);
      console.log('\n================ Summary ================');
      console.log('Passed ' + (results.length - failed.length) + '/' + results.length);
      if (failed.length) {
        console.log('Failed:');
        failed.forEach((f) => console.log('  - ' + f.name + (f.detail ? '  -> ' + f.detail : '')));
        if (!silent) process.exitCode = 1;
      }
      return failed.length === 0;
    },
  };
}

/** Poll a predicate until it returns a truthy value or the timeout expires. */
async function waitFor(fn, timeoutMs, intervalMs, label) {
  const deadline = Date.now() + (timeoutMs || 15000);
  intervalMs = intervalMs || 300;
  for (;;) {
    let value;
    try {
      value = await fn();
    } catch (e) {
      value = null;
    }
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for: ' + (label || 'condition'));
    }
    await sleep(intervalMs);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { findChrome, launch, collectErrors, makeChecker, waitFor, sleep };
