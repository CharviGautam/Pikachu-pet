import {
  CANVAS_PX,
  DISPLAY_LOGICAL_PX,
  SPRITE_OFFSET_X,
  SPRITE_OFFSET_Y,
  FEET_Y_LOGICAL,
} from "../../shared/constants";
import type { SpriteCache, PoseSprite } from "./sprite-cache";
import type { Animator } from "./animator";
import { drawShadow } from "./shadow";
import { fitPose, poseForAnimation } from "./pikachu";
import type { PikaPose } from "./pikachu";

export interface MotionTransform {
  offsetY: number; // hop / bounce
  offsetX: number; // lean toward cursor / shake
  scaleX: number; // squash / stretch
  scaleY: number;
  tilt: number; // radians, body lean around the feet anchor
}

export const NEUTRAL_MOTION: MotionTransform = {
  offsetY: 0,
  offsetX: 0,
  scaleX: 1,
  scaleY: 1,
  tilt: 0,
};

/** Transient surface emotions drawn on top of the pose, in canvas code. */
export interface Emotes {
  /** 0..1 kiss blush on the cheeks */
  blush: number;
  /** 0..1 angry red glowing cheeks + zigzag sparks */
  anger: number;
}

const ANCHOR_X = 128;

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private spriteCache: SpriteCache;
  private animator: Animator;
  private resizeObserver: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement, spriteCache: SpriteCache, animator: Animator) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Could not get 2D rendering context");
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.spriteCache = spriteCache;
    this.animator = animator;

    // Keep the backing store in sync with the OS window size: when the window
    // resizes (mini mode, settings scale), the canvas must resize with it or
    // the pet gets clipped out of view ("disappears").
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.syncSize());
      this.resizeObserver.observe(canvas);
    }
    window.addEventListener("resize", () => this.syncSize());
    this.syncSize();
  }

  /** Match canvas CSS size to backing resolution (256-logical design space). */
  private syncSize() {
    const cssW = this.canvas.clientWidth || 256;
    const cssH = this.canvas.clientHeight || 256;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
  }

  public render(
    motion: MotionTransform = NEUTRAL_MOTION,
    drawFx?: (ctx: CanvasRenderingContext2D) => void,
    drawBubble?: (ctx: CanvasRenderingContext2D) => void,
    emotes?: Emotes
  ) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Design space is 256×256 logical; back it with whatever the window is.
    const design = 256;
    const sx = w / design;
    const sy = h / design;

    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.clearRect(0, 0, design, design);

    // 1. Draw ground shadow (lifts with the hop)
    drawShadow(ctx, Math.max(0, -motion.offsetY));

    // 2. Draw the Pikachu pose (falls back to the legacy strip if a pose
    //    image has not finished loading).
    const renderState = this.animator.getRenderState();
    let pose: PikaPose = poseForAnimation(renderState.animation);
    const anger = emotes?.anger ?? 0;
    if (anger > 0.5) pose = "angry";

    const poseSprite = this.spriteCache.getPose(pose);
    if (poseSprite) {
      ctx.save();

      // Anchor transformations at the baseline feet: (128, FEET_Y_LOGICAL)
      ctx.translate(ANCHOR_X + motion.offsetX, FEET_Y_LOGICAL + motion.offsetY);
      ctx.rotate(motion.tilt);
      if (renderState.mirror) {
        ctx.scale(-1, 1);
      }
      ctx.scale(motion.scaleX, motion.scaleY);
      ctx.translate(-ANCHOR_X, -FEET_Y_LOGICAL);

      // Crossfade: current pose at (1 - alpha), previous pose over it at
      // alpha — but only when the two poses actually differ (otherwise the
      // sprite would just dim mid-fade).
      const crossfade = renderState.crossfade;
      const fromPose = crossfade ? poseForAnimation(crossfade.fromAnimation) : pose;
      const fading = !!crossfade && fromPose !== pose;
      if (fading) {
        ctx.globalAlpha = 1.0 - crossfade!.alpha;
      }
      this.drawPose(ctx, pose, poseSprite);
      if (fading) {
        const fromSprite = this.spriteCache.getPose(fromPose);
        if (fromSprite) {
          ctx.globalAlpha = crossfade!.alpha;
          this.drawPose(ctx, fromPose, fromSprite);
        }
        ctx.globalAlpha = 1.0;
      }

      // 3. Surface emotions — blush / angry glow + sparks, locked to the
      //    cheeks of whichever pose is showing so they always line up.
      const blush = emotes?.blush ?? 0;
      if (blush > 0.01) this.drawBlush(ctx, pose, poseSprite, blush);
      if (anger > 0.01) this.drawAnger(ctx, pose, poseSprite, anger);

      ctx.restore();
    } else {
      this.drawLegacyStrip(ctx, renderState, motion, !!renderState.crossfade);
    }

    // 4. Draw FX
    if (drawFx) {
      ctx.save();
      drawFx(ctx);
      ctx.restore();
    }

    // 5. Draw speech bubble
    if (drawBubble) {
      ctx.save();
      drawBubble(ctx);
      ctx.restore();
    }
  }

  /** Fit + blit one pose inside the current transform. */
  private drawPose(ctx: CanvasRenderingContext2D, pose: PikaPose, sprite: PoseSprite) {
    const box = fitPose(pose, sprite.width, sprite.height);
    ctx.drawImage(sprite.image, box.x, box.y, box.w, box.h);
  }

  /** Soft pink blush blooming over both cheek blobs. */
  private drawBlush(
    ctx: CanvasRenderingContext2D,
    pose: PikaPose,
    sprite: PoseSprite,
    amount: number
  ) {
    const box = fitPose(pose, sprite.width, sprite.height);
    const { left, right, r } = sprite.cheeks;
    const radius = r * box.w * 1.6;
    for (const c of [left, right]) {
      const cx = box.x + c.x * box.w;
      const cy = box.y + c.y * box.h;
      const grad = ctx.createRadialGradient(cx, cy, radius * 0.15, cx, cy, radius);
      grad.addColorStop(0, `rgba(255, 96, 118, ${0.62 * amount})`);
      grad.addColorStop(0.65, `rgba(255, 120, 140, ${0.34 * amount})`);
      grad.addColorStop(1, "rgba(255, 140, 150, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Pulsing red glow on the cheeks plus zigzag electric sparks (canvas code). */
  private drawAnger(
    ctx: CanvasRenderingContext2D,
    pose: PikaPose,
    sprite: PoseSprite,
    amount: number
  ) {
    const box = fitPose(pose, sprite.width, sprite.height);
    const { left, right, r } = sprite.cheeks;
    const radius = r * box.w;
    const now = performance.now();
    const pulse = 0.62 + 0.38 * Math.sin(now / 110);

    const cheeks: { x: number; y: number; dirX: number; dirY: number; seed: number }[] = [
      {
        x: box.x + left.x * box.w,
        y: box.y + left.y * box.h,
        dirX: -0.94,
        dirY: 0.34,
        seed: 1,
      },
      {
        x: box.x + right.x * box.w,
        y: box.y + right.y * box.h,
        dirX: 0.94,
        dirY: 0.34,
        seed: 2,
      },
    ];

    // Red glowing cheeks
    for (const cheek of cheeks) {
      const g = radius * (1.7 + 0.5 * pulse);
      const grad = ctx.createRadialGradient(cheek.x, cheek.y, g * 0.1, cheek.x, cheek.y, g);
      grad.addColorStop(0, `rgba(255, 44, 44, ${0.78 * amount * pulse})`);
      grad.addColorStop(0.6, `rgba(230, 30, 30, ${0.4 * amount * pulse})`);
      grad.addColorStop(1, "rgba(200, 20, 20, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cheek.x, cheek.y, g, 0, Math.PI * 2);
      ctx.fill();
    }

    // Zigzag sparks — flicker by re-seeding ~15×/s
    const frame = Math.floor(now / 66);
    const flicker = 0.45 + 0.55 * hash(frame * 7.13);
    const sparkAlpha = amount * flicker;
    if (sparkAlpha < 0.12) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(255, 226, 90, 0.9)";
    ctx.shadowBlur = 7;
    for (const cheek of cheeks) {
      const seed = frame * 13.7 + cheek.seed * 101;
      const len = 30 + hash(seed) * 18;
      ctx.beginPath();
      ctx.moveTo(cheek.x, cheek.y);
      let px = cheek.x;
      let py = cheek.y;
      const segs = 5;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const end = i === segs;
        px = cheek.x + cheek.dirX * len * t + (hash(seed + i) - 0.5) * (end ? 4 : 11);
        py = cheek.y + cheek.dirY * len * t + (hash(seed + i * 3.7) - 0.5) * (end ? 4 : 11);
        ctx.lineTo(px, py);
      }
      ctx.globalAlpha = sparkAlpha;
      ctx.strokeStyle = "rgba(255, 232, 96, 0.95)";
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255, 255, 235, 0.9)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.shadowBlur = 7;
    }
    ctx.restore();
  }

  /** Legacy 384px strip path — used only until the pose images decode. */
  private drawLegacyStrip(
    ctx: CanvasRenderingContext2D,
    renderState: ReturnType<Animator["getRenderState"]>,
    motion: MotionTransform,
    withCrossfade: boolean
  ) {
    const stripImg = this.spriteCache.get(renderState.animation);
    if (!stripImg) return;

    ctx.save();
    ctx.translate(ANCHOR_X + motion.offsetX, FEET_Y_LOGICAL + motion.offsetY);
    ctx.rotate(motion.tilt);
    if (renderState.mirror) {
      ctx.scale(-1, 1);
    }
    ctx.scale(motion.scaleX, motion.scaleY);
    ctx.translate(-ANCHOR_X, -FEET_Y_LOGICAL);

    const sxFrame = renderState.frameIndex * CANVAS_PX;
    const dx = SPRITE_OFFSET_X;
    const dy = SPRITE_OFFSET_Y;
    const dw = DISPLAY_LOGICAL_PX;
    const dh = DISPLAY_LOGICAL_PX;

    if (withCrossfade && renderState.crossfade) {
      ctx.globalAlpha = 1.0 - renderState.crossfade.alpha;
    }
    ctx.drawImage(stripImg, sxFrame, 0, CANVAS_PX, CANVAS_PX, dx, dy, dw, dh);

    if (withCrossfade && renderState.crossfade) {
      const fromImg = this.spriteCache.get(renderState.crossfade.fromAnimation);
      if (fromImg) {
        ctx.globalAlpha = renderState.crossfade.alpha;
        const fromSx = renderState.crossfade.fromFrame * CANVAS_PX;
        ctx.drawImage(fromImg, fromSx, 0, CANVAS_PX, CANVAS_PX, dx, dy, dw, dh);
      }
    }
    ctx.restore();
  }
}

/** Deterministic 0..1 hash for spark jitter/flicker. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}
