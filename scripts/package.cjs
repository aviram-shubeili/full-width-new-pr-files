const fs = require('node:fs');
const path = require('node:path');
const { zipSync, unzipSync } = require('fflate');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Package and extension versions must match.');

// Explicit allowlist keeps development files and screenshots out of releases.
const files = ['extension/manifest.json', 'extension/content.js', 'extension/content.css', 'README.md', 'LICENSE'];
const entries = {};
for (const file of files) entries[file] = [new Uint8Array(fs.readFileSync(path.join(root, file))), { mtime: new Date('2026-01-01T00:00:00Z') }];
const archive = zipSync(entries, { level: 9 });
const unpacked = unzipSync(archive);
for (const file of files) {
  if (!Buffer.from(unpacked[file]).equals(fs.readFileSync(path.join(root, file)))) throw new Error(`Archive verification failed: ${file}`);
}
const destination = path.join(root, 'dist', `full-width-new-pr-files-v${manifest.version}.zip`);
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, archive);
console.log(`Created and verified ${path.relative(root, destination)} (${archive.length} bytes)`);
