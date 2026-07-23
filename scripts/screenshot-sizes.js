/**
 * screenshot-sizes.js — launches the REAL app (same IPC handlers, same boot
 * sequence as `npm start`) and resizes its window through a handful of sizes,
 * screenshotting each, so you can eyeball CSS/layout breakage on resize
 * without manually dragging the window around.
 *
 * This is an Electron script (needs BrowserWindow), not a headless Node
 * script — run it with `electron`, not `node`:
 *
 *   npm run devtest:screenshots
 *   npm run devtest:screenshots -- --sizes=min,large
 *
 * Output: screenshots land in devtest-output/screenshots/<timestamp>/*.png
 *
 * Flags likely overflow: if the page's scrollWidth exceeds the window's
 * content width at a given size, something is probably clipping — printed
 * as a warning, not a hard fail (a scrollable log panel is fine; the outer
 * app shell overflowing horizontally is not).
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const SIZES = {
  'min':         { width: 860,  height: 640 },   // hard floor — main.js minWidth/minHeight
  'default':     { width: 1100, height: 820 },   // main.js initial size
  'laptop':      { width: 1366, height: 768 },   // common laptop res
  'large':       { width: 1920, height: 1080 },  // common desktop res
  'ultrawide':   { width: 2560, height: 1080 },  // stress-test wide layouts
  'tall-narrow': { width: 900,  height: 1200 },  // stress-test narrow-but-tall
};

const sizesArg = process.argv.find(a => a.startsWith('--sizes='));
const requested = sizesArg
  ? sizesArg.replace('--sizes=', '').split(',')
  : Object.keys(SIZES);

// Boot the REAL app — same window, same IPC handlers, same preload as `npm start`.
// This makes main.js call createWindow() + register every ipcMain.handle() for us.
require('../main.js');

async function run() {
  // Wait for main.js's app.whenReady().then(...) to create the window.
  const win = await waitForMainWindow();

  const outDir = path.join(__dirname, '..', 'devtest-output', 'screenshots', String(Date.now()));
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`\nScreenshotting ${requested.length} window size(s) → ${outDir}\n`);

  // Wait for the boot sequence (dep check + config + settings) to actually
  // finish rather than guessing with a fixed delay — the first FFmpeg probe
  // can take a few seconds. Polls for the boot-loader spinner to disappear.
  await waitForAppReady(win);

  let anyOverflow = false;

  for (const name of requested) {
    const size = SIZES[name];
    if (!size) {
      console.log(`⚠ Unknown size "${name}", skipping. Known: ${Object.keys(SIZES).join(', ')}`);
      continue;
    }

    win.setContentSize(size.width, size.height);
    // 1.5s: long enough for CSS/layout to settle AND for macOS's native
    // resize-size HUD (the transient "860×640" pill some window managers show
    // during programmatic resize) to fade before we capture — otherwise it
    // gets baked into the screenshot and can be mistaken for a real UI bug.
    await sleep(1500);

    const overflow = await win.webContents.executeJavaScript(`
      (function() {
        const html = document.documentElement;
        return {
          scrollWidth: html.scrollWidth,
          clientWidth: html.clientWidth,
        };
      })()
    `).catch(() => null);

    const filePath = path.join(outDir, `${name}_${size.width}x${size.height}.png`);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(filePath, image.toPNG());

    let overflowNote = '';
    if (overflow && overflow.scrollWidth > overflow.clientWidth + 2) {
      anyOverflow = true;
      overflowNote = `  ⚠ HORIZONTAL OVERFLOW: content ${overflow.scrollWidth}px in a ${overflow.clientWidth}px window`;
    }

    console.log(`✓ ${name.padEnd(12)} ${size.width}×${size.height}  →  ${path.basename(filePath)}${overflowNote}`);
  }

  console.log(`\nDone. Open the folder to review:\n  ${outDir}`);
  if (anyOverflow) {
    console.log('\n⚠ One or more sizes showed horizontal overflow — check the flagged screenshots above.');
  }

  app.exit(0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Polls the renderer until the boot-loader spinner (".boot-loader") is gone,
// meaning App.jsx's depStatus/config/settings bootstrap effect has resolved.
// Falls back to a fixed wait if it never resolves (still-useful: you get a
// screenshot of whatever's stuck, which is itself diagnostic).
async function waitForAppReady(win, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const stillBooting = await win.webContents.executeJavaScript(
      `!!document.querySelector('.boot-loader')`
    ).catch(() => true);
    if (!stillBooting) return;
    await sleep(300);
  }
  console.log('⚠ App did not leave the boot-loader state within ' + (timeoutMs / 1000) + 's — screenshots below may show the loading spinner.');
}

function waitForMainWindow() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for the app window to open (10s)')), 10000);
    const check = () => {
      const wins = BrowserWindow.getAllWindows();
      if (wins.length > 0) {
        clearTimeout(timeout);
        resolve(wins[0]);
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

run().catch(err => {
  console.error('Screenshot run failed:', err);
  app.exit(1);
});
