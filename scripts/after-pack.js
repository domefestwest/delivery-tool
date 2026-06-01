/**
 * after-pack.js — runs after electron-builder packs each platform.
 *
 * Purpose: ad-hoc sign the macOS .app bundle so Gatekeeper shows the friendly
 * "unidentified developer — Open Anyway" path instead of the brick-wall
 * "is damaged and can't be opened" message.
 *
 * Ad-hoc signing (`codesign --sign -`) doesn't make the app trusted by
 * Apple, but it satisfies Gatekeeper's "has a signature" check, which is
 * what triggers the user-bypassable warning instead of the no-bypass error.
 *
 * Skipped on Windows and Linux (codesign is macOS-only).
 * Skipped if codesign is missing for any reason — build still succeeds.
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  if (!fs.existsSync(appPath)) {
    console.log(`[after-pack] No .app found at ${appPath}, skipping ad-hoc sign`);
    return;
  }

  try {
    console.log(`[after-pack] Ad-hoc signing ${appPath}`);
    execFileSync('codesign', [
      '--force',
      '--deep',
      '--sign', '-',
      '--timestamp=none',
      appPath,
    ], { stdio: 'inherit' });

    // Verify the signature is present (not VALID for Apple's purposes — just present)
    execFileSync('codesign', ['--verify', '--verbose=2', appPath], { stdio: 'inherit' });
    console.log('[after-pack] ✓ Ad-hoc signature applied successfully');
  } catch (err) {
    console.warn('[after-pack] codesign failed (build still succeeds):', err.message);
  }
};
