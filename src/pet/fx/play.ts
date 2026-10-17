import { PALETTE } from "../../generated/palette";
import type { Particle } from "./particles";

/** "Ha ha" laugh puff for TV_LAUGH. */
export class LaughParticle implements Particle {
  public x: number;
  public y: number;
  public vx: number;
  public vy: number = -30;
  public life: number = 0;
  public maxLife: number = 900;
  private text: string;

  constructor(x: number = 150, y: number = 110, seed: number = 0) {
    this.x = x + (seed % 3) * 10 - 10;
    this.y = y - (seed % 2) * 8;
    this.vx = (seed % 2 === 0 ? 1 : -1) * (14 + (seed % 3) * 6);
    this.text = seed % 2 === 0 ? "ha" : "Ha";
  }

  public update(dtMs: number): boolean {
    this.life += dtMs;
    const dtSec = dtMs / 1000;
    this.x += this.vx * dtSec;
    this.y += this.vy * dtSec;
    return this.life < this.maxLife;
  }

  public draw(ctx: CanvasRenderingContext2D) {
    const progress = this.life / this.maxLife;
    const alpha = progress < 0.7 ? 1.0 : 1.0 - (progress - 0.7) / 0.3;
    ctx.save();
    ctx.font = `bold ${Math.round(11 + progress * 5)}px ui-rounded, system-ui, sans-serif`;
    ctx.fillStyle = PALETTE["--fx-heart"];
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
}

/** Music note for DANCE. */
export class NoteParticle implements Particle {
  public x: number;
  public y: number;
  public vx: number;
  public vy: number = -34;
  public life: number = 0;
  public maxLife: number = 1200;
  private glyph: string;
  private wobble: number;

  constructor(x: number = 150, y: number = 110, seed: number = 0) {
    this.x = x + (seed % 4) * 9 - 14;
    this.y = y - (seed % 3) * 6;
    this.vx = (seed % 2 === 0 ? 1 : -1) * 10;
    this.glyph = seed % 2 === 0 ? "♪" : "♫";
    this.wobble = seed * 1.7;
  }

  public update(dtMs: number): boolean {
    this.life += dtMs;
    const dtSec = dtMs / 1000;
    this.wobble += dtSec * 6;
    this.x += (this.vx + Math.sin(this.wobble) * 12) * dtSec;
    this.y += this.vy * dtSec;
    return this.life < this.maxLife;
  }

  public draw(ctx: CanvasRenderingContext2D) {
    const progress = this.life / this.maxLife;
    const alpha = progress < 0.75 ? 1.0 : 1.0 - (progress - 0.75) / 0.25;
    ctx.save();
    ctx.font = `bold ${Math.round(13 + progress * 4)}px system-ui, sans-serif`;
    ctx.fillStyle = PALETTE["--fx-zzz"];
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillText(this.glyph, this.x, this.y);
    ctx.restore();
  }
}

/**
 * The Poké Ball: code-drawn (red top, white bottom, black band, spinning
 * highlight). Supports grab (follows the pointer with no physics) and throw
 * (gravity, bounce, roll with spin) for both engine-spawned and user-thrown
 * balls.
 */
export class BallParticle implements Particle {
  public x: number;
  public y: number = 242; // ground line (window-local logical)
  public vx: number = 0;
  public vy: number = 0;
  public life: number = 0;
  public maxLife: number;
  /** true while the user is holding it (physics paused, position set directly) */
  public grabbed: boolean = false;
  public readonly r = 11;
  private rollAngle = 0;

  constructor(x: number = 128, vx: number = 0, maxLife: number = 3000) {
    this.x = x;
    this.vx = vx;
    this.maxLife = maxLife;
  }

  public update(dtMs: number): boolean {
    this.life += dtMs;
    if (this.grabbed) return true;

    const dtSec = dtMs / 1000;
    this.x += this.vx * dtSec;
    this.y += this.vy * dtSec;
    this.vy += 420 * dtSec; // gravity

    // Bounce on the ground line, then roll with friction.
    if (this.y > 242) {
      this.y = 242;
      if (this.vy > 50) {
        this.vy = -this.vy * 0.45; // bounce restitution
      } else {
        this.vy = 0;
      }
    }
    if (this.y >= 241.5) {
      this.vx *= 1 - 1.1 * dtSec; // roll friction
      if (Math.abs(this.vx) < 4) this.vx = 0;
    } else {
      this.vx *= 1 - 0.1 * dtSec; // air drag
    }

    // Soft walls so the ball stays inside the pet window.
    if (this.x < this.r + 4) {
      this.x = this.r + 4;
      this.vx = Math.abs(this.vx) * 0.5;
    } else if (this.x > 256 - this.r - 4) {
      this.x = 256 - this.r - 4;
      this.vx = -Math.abs(this.vx) * 0.5;
    }

    // Rolling spin (visual only)
    this.rollAngle += (this.vx / this.r) * dtSec;

    return this.life < this.maxLife;
  }

  public draw(ctx: CanvasRenderingContext2D) {
    const progress = this.life / this.maxLife;
    const alpha = progress > 0.9 ? 1.0 - (progress - 0.9) / 0.1 : 1.0;
    const cx = this.x;
    const cy = this.y - this.r;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

    // ground shadow
    const lift = Math.max(0, 242 - this.y);
    const squash = Math.max(0.35, 1 - lift / 90);
    ctx.beginPath();
    ctx.ellipse(this.x, 243, this.r * 0.95 * squash, 2.6 * squash, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(60,40,30,0.25)";
    ctx.fill();

    // White bottom half
    ctx.beginPath();
    ctx.arc(cx, cy, this.r, 0, Math.PI);
    ctx.fillStyle = "#F7F4EC";
    ctx.fill();

    // Red top half
    ctx.beginPath();
    ctx.arc(cx, cy, this.r, Math.PI, Math.PI * 2);
    ctx.fillStyle = "#DC3A3A";
    ctx.fill();

    // Black equator band
    ctx.fillStyle = "#2B2B2B";
    ctx.fillRect(cx - this.r, cy - 2.2, this.r * 2, 4.4);

    // Outline
    ctx.beginPath();
    ctx.arc(cx, cy, this.r, 0, Math.PI * 2);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "#2B2B2B";
    ctx.stroke();

    // Center button
    ctx.beginPath();
    ctx.arc(cx, cy, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = "#2B2B2B";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = "#F7F4EC";
    ctx.fill();

    // Highlight that spins as the ball rolls
    const ha = this.rollAngle;
    const hx = cx + Math.cos(ha) * this.r * 0.45 - 1;
    const hy = cy - this.r * 0.5 + Math.sin(ha) * 2;
    ctx.beginPath();
    ctx.ellipse(hx, hy, 3.4, 1.8, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fill();

    ctx.restore();
  }
}
