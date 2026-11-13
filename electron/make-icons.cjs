// Makes the app icons from the chosen image (electron/icons/source.png):
// white corners made transparent, multi-size app.ico (window, taskbar, shortcuts), app.png, and the
// notification area icons (colour = a session needs attention, grey = nothing pending).
// Run: node_modules\electron\dist\electron.exe electron\make-icons.cjs
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'icons');

/** Makes transparent the almost white pixels connected to the corners (the background around the rounded square). */
function cutOut(img) {
  const { width: w, height: h } = img.getSize();
  const px = Buffer.from(img.toBitmap()); // BGRA
  const white = i => px[i] > 225 && px[i + 1] > 225 && px[i + 2] > 225;
  const seen = new Uint8Array(w * h);
  const stack = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h || seen[y * w + x]) continue;
    seen[y * w + x] = 1;
    const i = (y * w + x) * 4;
    if (!white(i)) continue;
    px[i + 3] = 0;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  // Smoothed edge: a light pixel next to a transparent one becomes half transparent
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = (y * w + x) * 4;
    if (px[i + 3] === 0 || !(px[i] > 190 && px[i + 1] > 190 && px[i + 2] > 190)) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => px[((y + dy) * w + x + dx) * 4 + 3] === 0)) px[i + 3] = 110;
  }
  return nativeImage.createFromBitmap(px, { width: w, height: h });
}

/** Grey version (notification area when nothing is pending). */
function greyOut(img) {
  const { width: w, height: h } = img.getSize();
  const px = Buffer.from(img.toBitmap());
  for (let i = 0; i < px.length; i += 4) {
    const g = Math.round(px[i] * 0.11 + px[i + 1] * 0.59 + px[i + 2] * 0.3);
    px[i] = px[i + 1] = px[i + 2] = Math.round(g * 0.85 + 20);
  }
  return nativeImage.createFromBitmap(px, { width: w, height: h });
}

/** .ico file made of PNG images (format accepted by Windows since Vista). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const entries = [], data = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, png } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    entries.push(e); data.push(png); offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...data]);
}

app.whenReady().then(() => {
  const source = cutOut(nativeImage.createFromPath(path.join(DIR, 'source.png')));
  const sized = n => source.resize({ width: n, height: n, quality: 'best' });
  fs.writeFileSync(path.join(DIR, 'app.png'), sized(512).toPNG());
  fs.writeFileSync(path.join(DIR, 'app.ico'), ico([16, 24, 32, 48, 64, 128, 256].map(n => ({ size: n, png: sized(n).toPNG() }))));
  for (const n of [16, 32]) {
    fs.writeFileSync(path.join(DIR, `notif-alert-${n}.png`), sized(n).toPNG());
    fs.writeFileSync(path.join(DIR, `notif-idle-${n}.png`), greyOut(sized(n)).toPNG());
  }
  console.log('icons written to', DIR);
  app.quit();
});
