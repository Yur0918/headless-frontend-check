---
name: headless-frontend-check
description: Verify local frontend HTML/JS changes in a real browser using headless Chrome + puppeteer-core. Use when the user asks to check UI rendering, validate interactive states, verify a download, screenshot a page, or assert DOM conditions after modifying frontend files.
---

# Headless Frontend Check

Verify local frontend changes in a real Chromium browser without leaving the terminal.
Launches headless Chrome, loads a local URL, performs interactions, evaluates DOM
assertions, verifies downloads, and saves screenshots — catching layout regressions,
missing elements, stuck-disabled buttons, broken exports, and JavaScript runtime errors.

## When to Use

Trigger after frontend edits when the user asks to:
- "帮我看一下页面效果" / "校验一下前端" / "截图看看" / "自检一下 UI"
- "为什么按钮点不动/不显示"
- "点导出没反应" / "下载的文件不对"
- Any change to a local `index.html`, an Express/Flask static server, form validation,
  modals, upload widgets, or tables.

## Setup

```bash
npm install          # installs puppeteer-core (the only dependency)
```

A Chrome/Chromium binary is required but NOT bundled. It is auto-detected per platform
(macOS `/Applications/Google Chrome.app/...`, Linux `/usr/bin/google-chrome`, Windows
`Program Files\Google\Chrome\...`). Override with:

```bash
export PUPPETEER_EXECUTABLE_PATH=/path/to/chrome     # or CHROME_PATH
```

## Scripts

| Script | Purpose |
|---|---|
| `scripts/run-check.js <url> [screenshot]` | Smoke: load, title, runtime errors, full-page screenshot |
| `scripts/assert.js <config.json>` | Config-driven DOM assertions + error capture |
| `scripts/download.js <url> <selector> [dir] [ms]` | Click a selector, assert a file actually lands |

All three exit non-zero on failure, so they work in CI.

## Quick Start

```bash
# 1) Smoke + screenshot
node scripts/run-check.js http://localhost:3000 /tmp/home.png

# 2) Targeted assertions (see examples/assert-config.json)
node scripts/assert.js ./my-check.json

# 3) Verify an export button really downloads a file
DOWNLOAD_EXT=.zip node scripts/download.js http://localhost:3000 '#export'
```

## Workflow

1. Make sure the local dev server is running and reachable.
2. Start with `run-check.js` — it surfaces runtime errors immediately.
3. Write a JSON config for the specific things that should be true, then run `assert.js`.
4. For anything file-producing (export, batch download, report generation), run
   `download.js` — DOM assertions cannot see a missing download.
5. Look at the screenshot. Fix, then re-run until green.

## Assertion Config Reference

```json
{
  "url": "http://localhost:3000",
  "waitMs": 1200,
  "screenshot": "/tmp/shot.png",
  "assertions": [
    { "type": "title",    "contains": "My App" },
    { "type": "visible",  "selector": "#drop" },
    { "type": "hidden",   "selector": "#toolbar" },
    { "type": "text",     "selector": ".job-name", "contains": "报告.docx" },
    { "type": "count",    "selector": "#jobs .job", "equals": 3 },
    { "type": "count",    "selector": "#jobs .job", "min": 1 },
    { "type": "disabled", "selector": "#submit", "equals": false },
    { "type": "class",    "selector": "#modal", "has": "show" },
    { "type": "attr",     "selector": "img", "name": "src", "contains": ".png" }
  ]
}
```

`visible` counts as visible only when `display !== none`, `visibility !== hidden`,
and the element has non-zero size — so it catches "in the DOM but collapsed".

## Best Practices

- Always set an explicit desktop viewport (the helper defaults to 1280x900) so
  screenshots and layout assertions are stable.
- Always assert "no uncaught exceptions" and "no console errors" — `assert.js` and
  `download.js` do this automatically. A 404 for `/favicon.ico` is a common false
  positive; either ignore it or add an inline favicon.
- After an interaction, wait for a **specific condition** (`waitFor`) rather than a
  fixed sleep whenever possible; use short sleeps only for settle time.
- Use `page.on('dialog')` to auto-accept `alert`/`confirm` so a stray dialog does not
  hang the run (the helper does this, and records it as a console error).
- Screenshots are disposable — write them to a temp dir.
- Do not bundle a browser; rely on detection + `PUPPETEER_EXECUTABLE_PATH` so the repo
  stays small and works everywhere.

## Troubleshooting

- **"Could not find Chrome"** — set `PUPPETEER_EXECUTABLE_PATH`.
- **`--no-sandbox`** is already passed; if Chrome still fails to start in Docker/CI,
  add `--disable-gpu --single-process` via your own launch options.
- **Module not found: puppeteer-core** — run `npm install` in this repo, or set
  `NODE_PATH` to a directory that already has it.
- **Server not responding** — the check hits the URL directly; confirm the server is up
  and the port matches before blaming the script.
- **Download check finds nothing** — raise the timeout (4th arg); large exports and
  server-side zipping can take a while.
