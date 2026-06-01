/**
 * zip-package.js — create a ZIP of the delivery folder.
 *
 * Avoids adding an npm dependency by shelling out to platform-native zip:
 *   - macOS/Linux: /usr/bin/zip (preinstalled)
 *   - Windows: PowerShell's Compress-Archive (preinstalled since Win10)
 *
 * Single uploadable .zip is what most festival submission portals expect.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const platform = require('./platform');

/**
 * Zip a delivery folder into folder.zip in the same parent directory.
 *
 * @param {string} deliveryFolder — absolute path to the folder to zip
 * @returns {Promise<object>} { ok, zipPath, sizeBytes, error }
 */
async function zipDeliveryFolder(deliveryFolder) {
  if (!fs.existsSync(deliveryFolder)) {
    return { error: `Delivery folder not found: ${deliveryFolder}` };
  }

  const parent = path.dirname(deliveryFolder);
  const folderName = path.basename(deliveryFolder);
  const zipPath = path.join(parent, `${folderName}.zip`);

  // Remove existing zip first (zip and PowerShell both append vs overwrite differently)
  if (fs.existsSync(zipPath)) {
    try { fs.unlinkSync(zipPath); } catch (_) {}
  }

  let result;
  if (platform.isWin()) {
    result = await zipWithPowerShell(deliveryFolder, zipPath);
  } else {
    result = await zipWithUnixZip(deliveryFolder, zipPath, parent, folderName);
  }

  if (result.error) return result;

  if (!fs.existsSync(zipPath)) {
    return { error: 'Zip command completed but no zip file was produced.' };
  }

  const sizeBytes = fs.statSync(zipPath).size;
  return { ok: true, zipPath, sizeBytes };
}

function zipWithUnixZip(folder, zipPath, parent, folderName) {
  return new Promise(resolve => {
    let stderr = '';
    // Run from parent so the zip contains a top-level folder, not an absolute path
    const proc = spawn('zip', ['-r', '-q', zipPath, folderName], { cwd: parent });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => resolve({ error: `zip command not found or failed: ${err.message}` }));
    proc.on('close', code => {
      if (code !== 0) return resolve({ error: `zip exited ${code}: ${stderr.slice(-200)}` });
      resolve({ ok: true });
    });
  });
}

function zipWithPowerShell(folder, zipPath) {
  return new Promise(resolve => {
    let stderr = '';
    // -NoProfile speeds up startup. Force overwrite.
    const ps = `Compress-Archive -Path "${folder}" -DestinationPath "${zipPath}" -Force`;
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps,
    ]);
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => resolve({ error: `PowerShell launch failed: ${err.message}` }));
    proc.on('close', code => {
      if (code !== 0) return resolve({ error: `PowerShell exited ${code}: ${stderr.slice(-200)}` });
      resolve({ ok: true });
    });
  });
}

module.exports = { zipDeliveryFolder };
