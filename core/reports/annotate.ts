import sharp from "sharp";
import type { Box } from "../types";

export interface AnnotateMark {
  box: Box;
  color: string;
  label?: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function overlaySvg(width: number, height: number, marks: AnnotateMark[], scale: number, offX: number, offY: number): Buffer {
  const parts = marks
    .filter((m) => m.box[2] > 0 && m.box[3] > 0)
    .map((m) => {
      const x = (m.box[0] - offX) * scale;
      const y = (m.box[1] - offY) * scale;
      const w = Math.max(4, m.box[2] * scale);
      const h = Math.max(4, m.box[3] * scale);
      const stroke = Math.max(2, Math.round(3 * Math.min(1, scale * 1.5)));
      const label = m.label
        ? `<rect x="${x}" y="${Math.max(0, y - 16)}" width="${m.label.length * 7 + 8}" height="15" fill="${m.color}"/><text x="${x + 4}" y="${Math.max(11, y - 4)}" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#fff">${esc(m.label)}</text>`
        : "";
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${m.color}" stroke-width="${stroke}"/>${label}`;
    })
    .join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts}</svg>`);
}

/** Whole page scaled to `width` px with all changed areas outlined. JPEG. */
export async function annotateFullPage(png: Buffer, marks: AnnotateMark[], width = 520, maxHeight = 2400): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  const W = meta.width!;
  const H = meta.height!;
  const scale = Math.min(1, width / W);
  const outW = Math.round(W * scale);
  const outH = Math.min(Math.round(H * scale), maxHeight);
  const base = await sharp(png).resize({ width: outW }).extract({ left: 0, top: 0, width: outW, height: outH }).toBuffer();
  return sharp(base).composite([{ input: overlaySvg(outW, outH, marks, scale, 0, 0) }]).jpeg({ quality: 72 }).toBuffer();
}

/** Window around `focus` (or the top of the page) with the marks outlined, scaled to at most `width` px. JPEG. */
export async function annotateCrop(png: Buffer, focus: Box | null, marks: AnnotateMark[], width = 700): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  const W = meta.width!;
  const H = meta.height!;
  let rx = 0, ry = 0, rw = W, rh = Math.min(H, 700);
  if (focus) {
    const pad = 60;
    rw = Math.min(W, Math.max(focus[2] + pad * 2, Math.min(W, 700)));
    rx = Math.max(0, Math.min(W - rw, Math.round(focus[0] + focus[2] / 2 - rw / 2)));
    rh = Math.min(H, Math.max(focus[3] + pad * 2, 220), 900);
    ry = Math.max(0, Math.min(H - rh, Math.round(focus[1] + focus[3] / 2 - rh / 2)));
  }
  rw = Math.max(1, Math.round(rw));
  rh = Math.max(1, Math.round(rh));
  const scale = Math.min(1, width / rw);
  const outW = Math.round(rw * scale);
  const outH = Math.round(rh * scale);
  const base = await sharp(png).extract({ left: rx, top: ry, width: rw, height: rh }).resize({ width: outW, height: outH }).toBuffer();
  return sharp(base).composite([{ input: overlaySvg(outW, outH, marks, scale, rx, ry) }]).jpeg({ quality: 78 }).toBuffer();
}
