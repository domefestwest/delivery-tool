#!/usr/bin/env node
/**
 * embed-festival-icon.js
 *
 * Convert a festival's logo image (PNG/JPEG/SVG/WebP) into a base64
 * data URL that can be pasted into a festival config JSON as the
 * `festival_icon` field.
 *
 * Usage:
 *   node scripts/embed-festival-icon.js path/to/icon.png
 *   node scripts/embed-festival-icon.js path/to/icon.png > snippet.txt
 *
 * Recommended source size: 128×128 or 256×256.
 * Format: PNG with transparency works best (round corners, anti-aliasing).
 *
 * The script prints the JSON line ready to paste; it does NOT modify
 * your config file directly.
 */

const fs = require('fs');
const path = require('path');

const MIME_MAP = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
};

function fail(msg) {
  console.error('Error: ' + msg);
  process.exit(1);
}

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/embed-festival-icon.js <icon-file>');
  console.error('Example: node scripts/embed-festival-icon.js logos/festival.png');
  process.exit(1);
}

if (!fs.existsSync(input)) fail(`File not found: ${input}`);

const ext = path.extname(input).toLowerCase();
const mime = MIME_MAP[ext];
if (!mime) {
  fail(`Unsupported file type "${ext}". Use PNG, JPEG, SVG, WebP, or GIF.`);
}

const buf = fs.readFileSync(input);
const sizeKB = buf.length / 1024;
const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;

// Warnings
const warnings = [];
if (sizeKB > 200) {
  warnings.push(`File is ${sizeKB.toFixed(1)} KB — larger than recommended.`);
  warnings.push(`Consider downsizing to 128×128 or 256×256 to keep configs lean.`);
}
if (sizeKB > 500) {
  warnings.push(`At ${sizeKB.toFixed(1)} KB the icon will significantly slow down config loading.`);
}

// Output
console.error('--- snip ---');
console.error(`Source:           ${input}`);
console.error(`Format:           ${mime}`);
console.error(`Original size:    ${sizeKB.toFixed(1)} KB`);
console.error(`Base64 size:      ${(dataUrl.length / 1024).toFixed(1)} KB`);
if (warnings.length) {
  console.error('');
  warnings.forEach(w => console.error('⚠ ' + w));
}
console.error('--- snip ---');
console.error('');
console.error('Paste this line into your festival config JSON (inside the top-level object):');
console.error('');

// stdout = the actual snippet, so it can be piped to a file
console.log(`  "festival_icon": "${dataUrl}",`);

console.error('');
console.error('Note: include the trailing comma if there are more fields after,');
console.error('omit it if festival_icon is the last field in the object.');
