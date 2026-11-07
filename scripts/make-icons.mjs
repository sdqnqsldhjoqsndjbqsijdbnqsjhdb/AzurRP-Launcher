import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const svg = path.join(root, 'assets', 'brand', 'icon.svg');
const targets = [
  path.join(root, 'build', 'icon.png'),
  path.join(root, 'assets', 'brand', 'icon.png')
];

await mkdir(path.join(root, 'build'), { recursive: true });
const buffer = await sharp(svg, { density: 384 })
  .resize(1024, 1024, { fit: 'contain' })
  .png({ compressionLevel: 9, palette: true })
  .toBuffer();

for (const target of targets) {
  await mkdir(path.dirname(target), { recursive: true });
  await sharp(buffer).toFile(target);
}

console.log(`[icons] icône 1024x1024 générée (${targets.length} fichiers)`);
