import type { AnimationName } from "../../generated/animations";
import { FEET_Y_LOGICAL } from "../../shared/constants";

/**
 * Pikachu sprite layer.
 *
 * The pet is drawn from the five frames extracted from the reference images
 * (tools/prepare_ishq_sprites.py -> public/assets/ishq). Every animation the
 * behaviour engine can ask for maps onto one of those frames; animations we
 * have no frame for (walk, kiss, pounce, …) reuse a frame and get their life
 * from code-based motion (bob, sway, squash & stretch — see motion.ts).
 *
 * Design space is 256x256 logical px: the character is centred on x=128 and
 * stands on the feet line y=242 (FEET_Y_LOGICAL).
 */
export type PikaPose = "stand" | "jump" | "sleep" | "angry";

export const POSE_SRC: Record<PikaPose, string> = {
  stand: "/assets/ishq/happy.png",
  jump: "/assets/ishq/jump.png",
  sleep: "/assets/ishq/sleep.png",
  angry: "/assets/ishq/angry.png",
};

/** Largest box each pose may occupy, in logical px (feet stay on the line). */
const POSE_FIT: Record<PikaPose, { maxW: number; maxH: number }> = {
  stand: { maxW: 176, maxH: 174 },
  jump: { maxW: 176, maxH: 178 },
  sleep: { maxW: 184, maxH: 132 },
  // The angry frame is a wide 482×257 close-up crop (tail + ear stick out):
  // keep the box well inside the 256-logical design space (128-centred) so
  // the ±3.5px angry body shake never pushes it off-canvas.
  angry: { maxW: 232, maxH: 174 },
};

/**
 * Fallback cheek anchors, normalised to the frame's draw box, used only when
 * runtime detection (detectCheeks) cannot find two round red blobs.
 */
const POSE_CHEEKS_FALLBACK: Record<PikaPose, { left: [number, number]; right: [number, number]; r: number }> = {
  stand: { left: [0.203, 0.426], right: [0.526, 0.521], r: 0.035 },
  jump: { left: [0.53, 0.428], right: [0.732, 0.4], r: 0.045 },
  sleep: { left: [0.36, 0.5], right: [0.62, 0.58], r: 0.05 },
  angry: { left: [0.3, 0.56], right: [0.69, 0.5], r: 0.06 },
};

/** Which extracted frame each animation plays. */
export const ANIM_POSE: Record<AnimationName, PikaPose> = {
  idle_sit: "stand",
  look_left: "stand",
  look_right: "stand",
  look_up: "stand",
  look_down: "stand",
  stand_idle: "stand",
  sit_down: "stand",
  stand_up: "stand",
  walk: "stand",
  run: "jump",
  happy: "jump",
  excited: "jump",
  petting: "stand",
  kiss: "jump",
  surprised: "stand",
  sad: "stand",
  curious: "stand",
  scared: "stand",
  bored_sigh: "stand",
  bark: "stand",
  yawn: "stand",
  scratch_ear: "stand",
  stretch: "stand",
  sneeze: "stand",
  roll_over: "stand",
  paw_reach: "jump",
  trip: "jump",
  drag: "stand",
  sleep_down: "sleep",
  sleep_loop: "sleep",
  wake_up: "sleep",
  dance: "jump",
  chase_tail: "stand",
  tv_watch: "stand",
  tv_laugh: "jump",
  hungry: "stand",
  bone_sniff: "stand",
  ball_pounce: "jump",
};

export function poseForAnimation(anim: AnimationName): PikaPose {
  return ANIM_POSE[anim] ?? "stand";
}

export interface PoseBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fit a source image into its pose box: centred on 128, bottom on the feet line. */
export function fitPose(pose: PikaPose, natW: number, natH: number): PoseBox {
  const fit = POSE_FIT[pose];
  const s = Math.min(fit.maxW / natW, fit.maxH / natH);
  const w = natW * s;
  const h = natH * s;
  return { x: 128 - w / 2, y: FEET_Y_LOGICAL - h, w, h };
}

export interface Cheeks {
  /** normalised to the draw box (0..1) */
  left: { x: number; y: number };
  right: { x: number; y: number };
  /** radius relative to box width */
  r: number;
}

interface Blob {
  cx: number;
  cy: number;
  area: number;
}

/**
 * Find the two round red cheek blobs in a loaded pose image so blush / angry
 * glow land exactly on them, whatever the frame. Returns normalised anchors.
 * Falls back to the hand-measured constants when detection finds no pair.
 */
export function detectCheeks(
  source: CanvasImageSource,
  natW: number,
  natH: number,
  pose: PikaPose
): Cheeks {
  const fallback = POSE_CHEEKS_FALLBACK[pose];
  try {
    const canvas = document.createElement("canvas");
    canvas.width = natW;
    canvas.height = natH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return toCheeks(fallback);
    ctx.drawImage(source, 0, 0);
    const { data } = ctx.getImageData(0, 0, natW, natH);

    const red = new Uint8Array(natW * natH);
    for (let i = 0; i < natW * natH; i++) {
      const r = data[i * 4]!;
      const g = data[i * 4 + 1]!;
      const b = data[i * 4 + 2]!;
      const a = data[i * 4 + 3]!;
      if (a < 150) continue;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx === 0) continue;
      const sat = (mx - mn) / mx;
      if (sat < 0.4 || mx < 90) continue;
      // hue of a red / red-pink pixel (cheeks + mouth), not of Pikachu yellow
      let hue: number;
      if (mx === r) hue = (60 * (g - b)) / (mx - mn);
      else if (mx === g) hue = 120 + (60 * (b - r)) / (mx - mn);
      else hue = 240 + (60 * (r - g)) / (mx - mn);
      if (hue < 0) hue += 360;
      if (hue <= 24 || hue >= 336) red[i] = 1;
    }

    const blobs = labelBlobs(red, natW, natH).filter((bl) => {
      const frac = bl.area / (natW * natH);
      return frac >= 0.0004 && frac <= 0.05;
    });

    const pair = bestCheekPair(blobs, natW, natH);
    if (!pair) return toCheeks(fallback);
    pair.sort((p, q) => p.cx - q.cx);
    const [l, r] = pair;
    const area = Math.max(l.area, r.area);
    return {
      left: { x: l.cx / natW, y: l.cy / natH },
      right: { x: r.cx / natW, y: r.cy / natH },
      r: Math.max(0.02, Math.sqrt(area / Math.PI) / natW),
    };
  } catch {
    return toCheeks(fallback);
  }
}

function toCheeks(f: { left: [number, number]; right: [number, number]; r: number }): Cheeks {
  return {
    left: { x: f.left[0], y: f.left[1] },
    right: { x: f.right[0], y: f.right[1] },
    r: f.r,
  };
}

function labelBlobs(mask: Uint8Array, w: number, h: number): Blob[] {
  const seen = new Uint8Array(w * h);
  const out: Blob[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (mask[start] === 0 || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let area = 0;
    let sx = 0;
    let sy = 0;
    while (sp > 0) {
      const i = stack[--sp]!;
      const x = i % w;
      const y = (i - x) / w;
      area++;
      sx += x;
      sy += y;
      const push = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const j = ny * w + nx;
        if (!seen[j] && mask[j]) {
          seen[j] = 1;
          stack[sp++] = j;
        }
      };
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }
    out.push({ cx: sx / area, cy: sy / area, area });
  }
  return out;
}

/** Two same-sized blobs at a similar height, well separated horizontally. */
function bestCheekPair(blobs: Blob[], w: number, h: number): [Blob, Blob] | null {
  let best: [Blob, Blob] | null = null;
  let bestScore = 0;
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const a = blobs[i]!;
      const b = blobs[j]!;
      const dx = Math.abs(a.cx - b.cx) / w;
      const dy = Math.abs(a.cy - b.cy) / h;
      const ratio = Math.min(a.area, b.area) / Math.max(a.area, b.area);
      if (dx < 0.1 || dy > 0.18 || ratio < 0.45) continue;
      const score = ratio * dx * (1 - dy * 2);
      if (score > bestScore) {
        bestScore = score;
        best = [a, b];
      }
    }
  }
  return best;
}
