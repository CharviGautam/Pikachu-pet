import type { AnimationName } from "../../generated/animations";
import type { MotionTransform } from "./renderer";
import { NEUTRAL_MOTION } from "./renderer";

/**
 * Code-based motion.
 *
 * The Pikachu sprite set only has five frames, so everything that would
 * normally be animation frames — walk bob, kiss lean, dance sway, landing
 * squash & stretch, grumpy foot-tap, angry body shake — is synthesised here
 * as a transform applied around the feet anchor at (128, FEET_Y).
 *
 * The engine asks for an animation name; we turn that (plus a few flags)
 * into a continuous transform. Everything is time-based so it works at any
 * fps cap.
 */
export interface MotionContext {
  animation: AnimationName;
  /** seconds since the current animation started */
  animTimeSec: number;
  /** monotonic time in seconds (for idle sway continuity) */
  timeSec: number;
  petting: boolean;
  angry: boolean;
  grumpy: boolean;
  reduceMotion: boolean;
  /** window-local logical cursor position, if known */
  cursor: { x: number; y: number } | null;
}

/** Animations that bob (walk/run cycle, code-substituted for missing frames). */
const BOB_ANIMS: Record<string, { freq: number; amp: number }> = {
  walk: { freq: 3.2, amp: 3.5 },
  run: { freq: 4.6, amp: 6 },
  chase_tail: { freq: 3.0, amp: 4 },
  drag: { freq: 2.4, amp: 2 },
  stand_idle: { freq: 2.6, amp: 1.6 },
  idle_sit: { freq: 1.4, amp: 1.2 },
  look_left: { freq: 1.4, amp: 1.2 },
  look_right: { freq: 1.4, amp: 1.2 },
  look_up: { freq: 1.4, amp: 1.2 },
  look_down: { freq: 1.4, amp: 1.2 },
  petting: { freq: 1.8, amp: 1.4 },
  kiss: { freq: 2.2, amp: 3 },
  bark: { freq: 3.4, amp: 3 },
  curious: { freq: 1.6, amp: 1.5 },
  surprised: { freq: 5, amp: 4 },
  scared: { freq: 6, amp: 4 },
  yawn: { freq: 1.3, amp: 1.6 },
  stretch: { freq: 1.2, amp: 1.4 },
  bored_sigh: { freq: 1.2, amp: 1.2 },
  hungry: { freq: 1.3, amp: 1.3 },
  paw_reach: { freq: 2.4, amp: 2.5 },
  sleep_loop: { freq: 0.7, amp: 1.0 },
};

/**
 * A landing: triggered from ipc.onLanded (drag-drop) and synthesised at the
 * bottom of each hop so squashes happen even without a Rust event.
 */
export class MotionController {
  private squashImpulse = 0; // 1 → 0 decay
  private hopPrevY = 0;

  /** Kick a squash-and-stretch landing (drag drop, pounce impact). */
  public land(strength: number = 1) {
    this.squashImpulse = Math.max(this.squashImpulse, Math.min(1, strength));
  }

  public update(ctx: MotionContext): MotionTransform {
    const m: MotionTransform = { ...NEUTRAL_MOTION };
    const bob = BOB_ANIMS[ctx.animation];

    if (bob && !ctx.reduceMotion) {
      // Vertical bob; feet "leave the ground" on hops.
      m.offsetY = -Math.abs(Math.sin(ctx.timeSec * Math.PI * bob.freq)) * bob.amp;

      // Auto-land: when the bob comes back down through the floor, squash.
      if (this.hopPrevY < -1.2 && m.offsetY >= -1.2) {
        this.squashImpulse = Math.max(this.squashImpulse, Math.min(1, bob.amp / 8));
      }
      // Subtle counter-squash while airborne (stretch up).
      if (m.offsetY < -1.2) {
        m.scaleY = 1 + Math.min(0.06, -m.offsetY * 0.008);
        m.scaleX = 1 - Math.min(0.05, -m.offsetY * 0.007);
      }
    }
    this.hopPrevY = m.offsetY;

    // Landing squash & stretch: fast compress, springy recovery.
    if (this.squashImpulse > 0.001 && !ctx.reduceMotion) {
      const s = this.squashImpulse;
      m.scaleY *= 1 - 0.22 * s;
      m.scaleX *= 1 + 0.22 * s;
      m.offsetY += 6 * s * s;
      this.squashImpulse *= 0.86; // ~0.35 s to settle at 30 fps
    }

    if (ctx.reduceMotion) return m;

    // Dance / happy: sway side to side with a little tilt.
    if (ctx.animation === "dance" || ctx.animation === "happy" || ctx.animation === "excited") {
      const sw = Math.sin(ctx.timeSec * Math.PI * 2 * 0.9);
      m.offsetX = sw * 7;
      m.tilt = sw * 0.08;
    }

    // Petting: lean in toward the cursor with a contented wobble.
    if (ctx.petting) {
      const lean = ctx.cursor ? Math.sign(ctx.cursor.x - 128) * 4 : 0;
      m.offsetX += lean;
      m.tilt += lean * 0.01;
      m.scaleY *= 1.01;
      m.offsetY -= 1;
    }

    // Grumpy: grudge shuffle — grumpy foot tap as a tiny rhythmic dip.
    if (ctx.grumpy && !ctx.angry) {
      const tap = Math.max(0, Math.sin(ctx.timeSec * Math.PI * 2 * 1.8));
      m.offsetY += tap * 2.5;
      m.tilt += Math.sin(ctx.timeSec * Math.PI * 2 * 0.5) * 0.03;
    }

    // Angry: fast body shake (spec: "angry sprite, body shake").
    if (ctx.angry) {
      const shake = Math.sin(ctx.timeSec * Math.PI * 2 * 9);
      m.offsetX += shake * 3.5;
      m.tilt += shake * 0.045;
      m.scaleY *= 0.97;
      m.scaleX *= 1.03;
    }

    // Eyes/head follow: tilt very slightly toward the cursor so he "notices"
    // even while standing on the single stand frame.
    if (ctx.cursor && !ctx.angry && !ctx.petting) {
      const dx = ctx.cursor.x - 128;
      if (Math.abs(dx) > 40) {
        m.tilt += Math.max(-0.05, Math.min(0.05, dx * 0.0004));
        m.offsetX += Math.max(-3, Math.min(3, dx * 0.02));
      }
    }

    return m;
  }
}
