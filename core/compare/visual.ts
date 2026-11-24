import pixelmatch from "pixelmatch";
import sharp from "sharp";
import type { Box } from "../types";

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualDiffResult {
  width: number;
  height: number;
  beforeHeight: number;
  afterHeight: number;
  diffPixels: number;
  diffPercent: number;
  regions: Region[];
  diffPng: Buffer;
}

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

async function toRaw(buf: Buffer, width: number, height: number) {
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? width;
  const h = meta.height ?? height;
  let img = sharp(buf).ensureAlpha();
  if (w < width || h < height) img = sharp(await img.extend({ right: width - w, bottom: height - h, background: WHITE }).png().toBuffer()).ensureAlpha();
  if (w > width || h > height) img = img.extract({ left: 0, top: 0, width, height });
  return img.raw().toBuffer();
}

/**
 * Pixel comparison of two screenshots (pixelmatch). Images of different size are padded with white.
 * Returns the diff percentage, a diff image and bounding boxes of changed regions.
 */
export async function visualDiff(before: Buffer, after: Buffer, opts: { threshold: number; maxHeight?: number }): Promise<VisualDiffResult> {
  const [ma, mb] = await Promise.all([sharp(before).metadata(), sharp(after).metadata()]);
  const width = Math.max(ma.width!, mb.width!);
  const height = Math.min(Math.max(ma.height!, mb.height!), opts.maxHeight ?? 30_000);
  const [a, b] = await Promise.all([toRaw(before, width, height), toRaw(after, width, height)]);
  const diff = Buffer.alloc(width * height * 4);
  const diffPixels = pixelmatch(a, b, diff, width, height, {
    threshold: opts.threshold,
    includeAA: false,
    alpha: 0.15,
    diffColor: [255, 0, 0],
    aaColor: [255, 255, 0],
  });
  const regions = findRegions(diff, width, height);
  const diffPng = await sharp(diff, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  return {
    width,
    height,
    beforeHeight: ma.height!,
    afterHeight: mb.height!,
    diffPixels,
    diffPercent: Math.round((diffPixels / (width * height)) * 100 * 1000) / 1000,
    regions,
    diffPng,
  };
}

/** Groups diff pixels (pure red in pixelmatch output) into connected regions using a coarse grid. */
export function findRegions(diff: Buffer, width: number, height: number, cell = 16, maxRegions = 12): Region[] {
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const grid = new Uint8Array(cols * rows);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / cell) * cols;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (diff[i] === 255 && diff[i + 1] === 0 && diff[i + 2] === 0) grid[row + Math.floor(x / cell)] = 1;
    }
  }
  // Connected components with a 2-cell gap tolerance.
  const seen = new Uint8Array(cols * rows);
  const regions: Region[] = [];
  const gap = 2;
  for (let start = 0; start < grid.length; start++) {
    if (!grid[start] || seen[start]) continue;
    let minX = cols, minY = rows, maxX = 0, maxY = 0, count = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % cols;
      const cy = (c - cx) / cols;
      count++;
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cx > maxX) maxX = cx;
      if (cy > maxY) maxY = cy;
      for (let dy = -gap; dy <= gap; dy++)
        for (let dx = -gap; dx <= gap; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const n = ny * cols + nx;
          if (grid[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
    }
    if (count < 1) continue;
    regions.push({
      x: minX * cell,
      y: minY * cell,
      width: Math.min(width, (maxX + 1) * cell) - minX * cell,
      height: Math.min(height, (maxY + 1) * cell) - minY * cell,
    });
  }
  regions.sort((r1, r2) => r2.width * r2.height - r1.width * r1.height);
  return regions.slice(0, maxRegions).sort((r1, r2) => r1.y - r2.y);
}

/** Crops a region (with padding) from a screenshot as a JPEG, limited in size for reports. Null if out of bounds. */
export async function cropImage(png: Buffer, box: Box | Region, opts: { pad?: number; maxWidth?: number; maxHeight?: number } = {}): Promise<Buffer | null> {
  const meta = await sharp(png).metadata();
  const W = meta.width!;
  const H = meta.height!;
  const [bx, by, bw, bh] = Array.isArray(box) ? box : [box.x, box.y, box.width, box.height];
  if (bw <= 0 || bh <= 0) return null;
  const pad = opts.pad ?? 24;
  const left = Math.max(0, Math.floor(bx - pad));
  const top = Math.max(0, Math.floor(by - pad));
  if (left >= W || top >= H) return null;
  const width = Math.min(W - left, Math.ceil(bw + pad * 2));
  const height = Math.min(H - top, Math.ceil(bh + pad * 2), opts.maxHeight ?? 900);
  if (width < 4 || height < 4) return null;
  return sharp(png)
    .extract({ left, top, width, height })
    .resize({ width: Math.min(width, opts.maxWidth ?? 900), withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}
