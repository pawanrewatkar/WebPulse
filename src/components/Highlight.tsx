"use client";

import { useState } from "react";

export type Box = [number, number, number, number];
export interface Mark {
  box: Box;
  color: string;
  label?: string;
  onClick?: () => void;
}

/**
 * Shows a stored full-page screenshot with coloured boxes drawn around changed areas.
 * mode "crop": a window around `focus` (the changed element) – used in change cards.
 * mode "full": the whole page scaled to the column width – used for the page overview.
 */
export default function HighlightShot({
  src,
  marks,
  mode,
  focus,
  alt,
  maxHeight = 420,
}: {
  src: string;
  marks: Mark[];
  mode: "crop" | "full";
  focus?: Box | null;
  alt: string;
  maxHeight?: number;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  if (!size) {
    // Load once to learn the screenshot's real size; the visible rendering follows.
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-400">
        Loading screenshot…
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="hidden" onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      </div>
    );
  }
  const { w: W, h: H } = size;

  // Region of the screenshot to show.
  let rx = 0, ry = 0, rw = W, rh = H;
  if (mode === "crop" && focus) {
    const pad = 60;
    rw = Math.min(W, Math.max(focus[2] + pad * 2, Math.min(W, 700)));
    rx = Math.max(0, Math.min(W - rw, focus[0] + focus[2] / 2 - rw / 2));
    rh = Math.min(H, Math.max(focus[3] + pad * 2, 220), 900);
    ry = Math.max(0, Math.min(H - rh, focus[1] + focus[3] / 2 - rh / 2));
  } else if (mode === "crop") {
    rh = Math.min(H, 700); // no element position known: show the top of the page
  }
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  const frame = (
    <div className="relative w-full overflow-hidden" style={{ aspectRatio: `${rw} / ${rh}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="absolute max-w-none select-none" style={{ width: pct(W, rw), left: `-${pct(rx, rw)}`, top: `-${pct(ry, rh)}` }} draggable={false} />
      {marks.map((m, i) => {
        const [x, y, w, h] = m.box;
        if (w <= 0 || h <= 0) return null;
        const style = {
          left: pct(x - rx, rw),
          top: pct(y - ry, rh),
          width: pct(w, rw),
          height: pct(h, rh),
          borderColor: m.color,
          boxShadow: `0 0 0 3px ${m.color}33`,
        };
        return (
          <div
            key={i}
            className={`absolute rounded-sm border-[3px] ${m.onClick ? "cursor-pointer hover:bg-white/20" : "pointer-events-none"}`}
            style={style}
            title={m.label}
            onClick={m.onClick}
          >
            {m.label && (
              <span className="absolute -top-5 left-0 rounded px-1 text-[10px] font-bold whitespace-nowrap text-white" style={{ background: m.color }}>
                {m.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="overflow-auto rounded-lg border border-slate-200 bg-slate-50" style={{ maxHeight: mode === "full" ? maxHeight : undefined }}>
      {frame}
    </div>
  );
}
