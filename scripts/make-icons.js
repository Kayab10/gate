// Generates the PWA icons (no dependencies): node scripts/make-icons.js
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });

const BLUE = [77, 141, 255], INK = [0, 9, 26];
const CHECK = [[0.29, 0.53], [0.43, 0.67], [0.72, 0.36]];
const distSeg = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const inRoundRect = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
};

/** shape: 'round' = rounded square on transparent, 'full' = full-bleed square. scale shrinks the check for maskable safe zone. */
function render(size, shape, scale) {
  const px = Buffer.alloc(size * size * 4);
  const S = 3; // supersampling
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let cover = 0, ink = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = (x + (sx + 0.5) / S) / size, v = (y + (sy + 0.5) / S) / size;
      const inside = shape === 'full' || inRoundRect(u, v, 0.22);
      if (!inside) continue;
      cover++;
      const cu = 0.5 + (u - 0.5) / scale, cv = 0.5 + (v - 0.5) / scale;
      if (Math.min(distSeg(cu, cv, CHECK[0], CHECK[1]), distSeg(cu, cv, CHECK[1], CHECK[2])) <= 0.055) ink++;
    }
    const n = S * S, i = (y * size + x) * 4, f = cover ? ink / cover : 0;
    px[i] = Math.round(BLUE[0] * (1 - f) + INK[0] * f); px[i + 1] = Math.round(BLUE[1] * (1 - f) + INK[1] * f); px[i + 2] = Math.round(BLUE[2] * (1 - f) + INK[2] * f);
    px[i + 3] = Math.round((cover / n) * 255);
  }
  return px;
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const jobs = [['icon-192.png', 192, 'round', 1], ['icon-512.png', 512, 'round', 1], ['maskable-512.png', 512, 'full', 0.62], ['apple-touch-icon.png', 180, 'full', 0.8]];
for (const [name, size, shape, scale] of jobs) {
  fs.writeFileSync(path.join(out, name), png(size, render(size, shape, scale)));
  console.log('wrote', name);
}
