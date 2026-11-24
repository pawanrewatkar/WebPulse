"use client";

/** Shows a region of a stored full-page screenshot (no extra image processing needed). */
export default function RegionPreview({
  src,
  imageWidth,
  box,
  maxWidth = 360,
  maxHeight = 260,
}: {
  src: string;
  imageWidth: number;
  box: [number, number, number, number] | undefined | null;
  maxWidth?: number;
  maxHeight?: number;
}) {
  if (!box || box[2] <= 0 || box[3] <= 0) return <div className="text-xs text-gray-400">no preview</div>;
  const [x, y, w, h] = box;
  const scale = Math.min(1, maxWidth / w);
  return (
    <div className="overflow-hidden rounded border border-gray-200 bg-gray-50" style={{ width: Math.max(8, w * scale), height: Math.max(8, Math.min(h * scale, maxHeight)) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" loading="lazy" style={{ width: imageWidth * scale, maxWidth: "none", marginLeft: -x * scale, marginTop: -y * scale }} />
    </div>
  );
}
