/* Copy public/ into dist/public after tsc (CommonJS). */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'public');
const dst = path.join(root, 'dist', 'public');

function copyRecursive(from, to) {
  if (!fs.existsSync(from)) {
    console.warn(`[copy-public] skip: missing ${from}`);
    return;
  }
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, ent.name);
    const d = path.join(to, ent.name);
    if (ent.isDirectory()) copyRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

copyRecursive(src, dst);
console.log('[copy-public]', src, '->', dst);
