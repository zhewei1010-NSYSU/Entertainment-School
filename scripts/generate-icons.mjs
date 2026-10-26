import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
const original = await readFile(new URL('../favicon.svg', import.meta.url), 'utf8');
const content = original.slice(original.indexOf('>') + 1, original.lastIndexOf('</svg>'));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#873e32"/><g transform="translate(5.76 5.76) scale(.82)">${content}</g></svg>`;
for (const [size, name] of [[192, 'pwa-192.png'], [512, 'pwa-512.png'], [180, 'apple-touch-icon.png']]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(new URL('../public/' + name, import.meta.url).pathname);
}
