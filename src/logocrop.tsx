// Choosing the crop for a producer logo: the picture sits in a square frame;
// drag to move it, pinch / scroll / slider to make it bigger or smaller. What's
// inside the square is saved (as a 480 × 480 picture) and shown on the cards.

import { useEffect, useRef } from "react";

export interface PreparedImage {
  blob: Blob;
  ext: "png" | "jpg";
}

export interface LoadedImage {
  img: HTMLImageElement;
  /** Object URL; revoke with URL.revokeObjectURL when done. */
  url: string;
  w: number;
  h: number;
}

/** Where the picture sits in the frame: top-left corner (x, y) and scale z, in frame pixels. */
export interface View {
  x: number;
  y: number;
  z: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** On-screen size of the crop square. */
export const FRAME = 240;
/** Saved picture size. */
const OUT = 480;
/** Working size for finding margins. */
const WORK = 900;

export async function loadImage(file: Blob): Promise<LoadedImage> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("That file couldn't be read as a picture. Try a PNG or JPEG.");
  }
  return { img, url, w: img.naturalWidth || OUT, h: img.naturalHeight || OUT };
}

/** The part of the picture that isn't plain margin (common in screenshots), in picture pixels. */
export function suggestCrop(src: LoadedImage): Rect {
  const s = Math.min(1, WORK / Math.max(src.w, src.h));
  const w = Math.max(1, Math.round(src.w * s));
  const h = Math.max(1, Math.round(src.h * s));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src.img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  let transparent = false;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] < 250) {
      transparent = true;
      break;
    }
  }
  const [r0, g0, b0] = [px[0], px[1], px[2]];
  const isMargin = (i: number) =>
    px[i + 3] < 16 ||
    (!transparent && Math.abs(px[i] - r0) + Math.abs(px[i + 1] - g0) + Math.abs(px[i + 2] - b0) < 36);
  let top = h, left = w, right = -1, bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isMargin((y * w + x) * 4)) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return { x: 0, y: 0, w: src.w, h: src.h };
  return { x: left / s, y: top / s, w: (right - left + 1) / s, h: (bottom - top + 1) / s };
}

/** Fits a part of the picture inside the square with a small border. */
export function fitView(r: Rect, border = 0.06): View {
  const z = (FRAME * (1 - 2 * border)) / Math.max(r.w, r.h);
  return { z, x: FRAME / 2 - (r.x + r.w / 2) * z, y: FRAME / 2 - (r.y + r.h / 2) * z };
}

/** The whole picture, filling the square (cropping the longer side). */
export function fillView(src: LoadedImage): View {
  const z = FRAME / Math.min(src.w, src.h);
  return { z, x: FRAME / 2 - (src.w / 2) * z, y: FRAME / 2 - (src.h / 2) * z };
}

/** Saves what's inside the square. Transparent where the picture doesn't cover it. */
export async function renderCrop(src: LoadedImage, v: View): Promise<PreparedImage> {
  const k = OUT / FRAME;
  const c = document.createElement("canvas");
  c.width = OUT;
  c.height = OUT;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src.img, v.x * k, v.y * k, src.w * v.z * k, src.h * v.z * k);
  const px = ctx.getImageData(0, 0, OUT, OUT).data;
  let transparent = false;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] < 250) {
      transparent = true;
      break;
    }
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare the picture."))), transparent ? "image/png" : "image/jpeg", 0.9),
  );
  return { blob, ext: transparent ? "png" : "jpg" };
}

function zoomAround(v: View, px: number, py: number, z: number): View {
  return { z, x: px - ((px - v.x) * z) / v.z, y: py - ((py - v.y) * z) / v.z };
}

export function CropEditor({
  src,
  view,
  onChange,
  minZ,
  maxZ,
}: {
  src: LoadedImage;
  view: View;
  onChange: (v: View) => void;
  minZ: number;
  maxZ: number;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const latest = useRef(view);
  latest.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const clampZ = (z: number) => Math.min(maxZ, Math.max(minZ, z));

  // Scroll-wheel / trackpad zoom around the cursor (needs a non-passive listener).
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = latest.current;
      onChange(zoomAround(v, e.clientX - r.left, e.clientY - r.top, clampZ(v.z * Math.exp(-e.deltaY * 0.0015))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const local = (e: { clientX: number; clientY: number }) => {
    const r = frame.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const map = pointers.current;
    const prev = map.get(e.pointerId);
    if (!prev) return;
    const now = local(e);
    const v = latest.current;
    if (map.size === 1) {
      onChange({ ...v, x: v.x + now.x - prev.x, y: v.y + now.y - prev.y });
    } else if (map.size === 2) {
      // Pinch: zoom by the change in finger distance, around the midpoint.
      const other = [...map.entries()].find(([id]) => id !== e.pointerId)![1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(now.x - other.x, now.y - other.y);
      if (d0 > 0) {
        const mid = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
        const moved = { x: (now.x - prev.x) / 2, y: (now.y - prev.y) / 2 };
        const zv = zoomAround(v, mid.x, mid.y, clampZ(v.z * (d1 / d0)));
        onChange({ ...zv, x: zv.x + moved.x, y: zv.y + moved.y });
      }
    }
    map.set(e.pointerId, now);
  };

  const end = (e: React.PointerEvent) => void pointers.current.delete(e.pointerId);

  const style = (scale: number) => ({
    left: view.x * scale,
    top: view.y * scale,
    width: src.w * view.z * scale,
    height: src.h * view.z * scale,
  });

  // Slider works on a log scale so small and large pictures feel the same.
  const pos = Math.log(view.z / minZ) / Math.log(maxZ / minZ);

  return (
    <div className="crop">
      <div
        ref={frame}
        className="crop-frame"
        style={{ width: FRAME, height: FRAME }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, local(e));
        }}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <img src={src.url} alt="" draggable={false} style={style(1)} />
      </div>
      <div className="crop-side">
        <span className="muted small">On a card</span>
        <span className="logo-tile crop-mini">
          <span className="crop-mini-inner">
            <img src={src.url} alt="" draggable={false} style={style(46 / FRAME)} />
          </span>
        </span>
      </div>
      <label className="crop-zoom">
        <span className="muted small">Smaller</span>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(pos * 1000)}
          aria-label="Size"
          onChange={(e) => {
            const z = minZ * Math.pow(maxZ / minZ, Number(e.target.value) / 1000);
            onChange(zoomAround(view, FRAME / 2, FRAME / 2, z));
          }}
        />
        <span className="muted small">Bigger</span>
      </label>
    </div>
  );
}
