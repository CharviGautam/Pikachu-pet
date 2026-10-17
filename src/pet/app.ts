import { AudioManager } from "./audio/audio";
import { BehaviorEngine } from "./behavior/engine";
import { SeededRng, SystemClock } from "./behavior/rng";
import { SpeechBubble } from "./fx/bubble";
import { DustParticle, ExclamationParticle, QuestionParticle } from "./fx/emotes";
import { spawnKissHearts, spawnPettingBurst } from "./fx/hearts";
import { ParticlePool } from "./fx/particles";
import { ZzzParticle } from "./fx/zzz";
import { BallParticle, LaughParticle, NoteParticle } from "./fx/play";
import { CursorProcessor } from "./input/cursor";
import { PointerTracker } from "./input/pointer";
import { ipc } from "./ipc";
import { Animator } from "./render/animator";
import { MotionController } from "./render/motion";
import { Renderer } from "./render/renderer";
import { SpriteCache } from "./render/sprite-cache";
import { dist } from "../shared/math";
import type { CursorTickPayload, FxSpawn, Settings, Stage, StageInfo } from "../shared/types";

export class PikachuApp {
  private spriteCache: SpriteCache;
  private animator: Animator;
  private renderer: Renderer;
  private engine: BehaviorEngine;
  private pointerTracker: PointerTracker;
  private cursorProcessor: CursorProcessor;
  private audioManager: AudioManager;
  private particlePool: ParticlePool;
  private speechBubble: SpeechBubble;

  private settings!: Settings;
  private stage!: Stage;
  private lastCursorPayload: CursorTickPayload | null = null;
  private lastCursorPos: { x: number; y: number } = { x: 0, y: 0 };
  private stillMs: number = 0;
  private lastMoveTime: number = performance.now();
  private presenceReturned: boolean = false;
  private lastDustTime: number = 0;
  private lastTickTime: number = performance.now();
  private lastSavedTime: number = performance.now();
  private isRunning: boolean = false;

  // Code-based motion (bob / sway / squash — the sprite set has 5 frames)
  private motionController = new MotionController();
  private animTimeSec: number = 0;
  private lastAnimName: string = "";

  // Surface emotes: kiss blush + angry glow, ramped toward their targets
  private blush: number = 0;
  private anger: number = 0;

  // User-thrown Poké Ball lifecycle (grab / throw live in the pet window)
  private activeBall: BallParticle | null = null;
  private ballGrab: { vx: number; vy: number } | null = null;
  private prevPointerHeld: boolean = false;
  private lastBallTrackPos: { x: number; y: number } = { x: 0, y: 0 };
  private lastBallTrackMs: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.spriteCache = new SpriteCache();
    this.animator = new Animator();
    this.renderer = new Renderer(canvas, this.spriteCache, this.animator);
    this.pointerTracker = new PointerTracker(canvas);
    this.cursorProcessor = new CursorProcessor();
    this.audioManager = new AudioManager();
    this.particlePool = new ParticlePool();
    this.speechBubble = new SpeechBubble();

    // Default engine
    const rng = new SeededRng();
    const clock = new SystemClock();
    this.engine = new BehaviorEngine({
      rng,
      clock,
      settings: {
        schemaVersion: 1,
        name: "Pikachu",
        personality: "happy",
        scale: 1.0,
        alwaysOnTop: true,
        startWithSystem: true,
        monitor: "auto",
        cursorInteraction: true,
        pettingEnabled: true,
        randomBehaviours: true,
        speechBubbles: true,
        wakeOnReturn: true,
        soundEnabled: true,
        volume: 0.5,
        fpsCap: 30,
        lowPowerMode: false,
        reduceMotion: false,
        miniMode: false,
        visible: true,
        position: null,
        previousScale: null,
        firstRunDone: true,
        attentionDelaySec: 120,
        debugFastAttention: false,
      },
    });
  }

  public async start() {
    this.settings = await ipc.getSettings();
    this.stage = await ipc.getStage();

    this.audioManager.setMasterVolume(this.settings.volume);
    this.audioManager.setMuted(!this.settings.soundEnabled);

    // Preload pinned core sprite strips
    await this.spriteCache.preloadPinned();

    // Listen to cursor events from Rust
    await ipc.onCursorTick((payload) => {
      this.lastCursorPayload = payload;
    });

    // Listen to settings changes
    await ipc.onSettingsChanged((newSettings) => {
      const scaleChanged = newSettings.scale !== this.settings?.scale || newSettings.miniMode !== this.settings?.miniMode;
      this.settings = newSettings;
      this.audioManager.setMasterVolume(newSettings.volume);
      this.audioManager.setMuted(!newSettings.soundEnabled);

      // Mini mode: 0.5x window (PRD F12) — applied through the same scale path
      if (scaleChanged) {
        void this.applyScale();
      }
    });

    // Context / tray menu actions
    await ipc.onMenuAction((action) => this.handleMenuAction(action));

    // Motion feedback from the Rust motion thread
    await ipc.onArrived(() => {
      this.engine.notifyArrived();
    });
    await ipc.onLanded(() => {
      this.engine.notifyLanded();
      this.motionController.land(0.9); // squash & stretch on touch-down
      void ipc.getStage().then((stage) => {
        this.stage = stage;
      });
    });

    // Keep stage fresh while the window walks / falls / gets dragged, so
    // wander targets and cursor math use the live window position.
    await ipc.onMoved(() => {
      void ipc.getStage().then((stage) => {
        this.stage = stage;
      });
    });

    // Hitbox covering the real sprite content (window-local logical px):
    // measured content spans x 60..196, y 92..242 at 1.0 scale.
    void ipc.setHitbox({ x: 56, y: 88, width: 144, height: 160 });

    // Say first run greeting if not done
    if (!this.settings.firstRunDone) {
      this.speechBubble.show({ text: `Hi,[${this.settings.name}]!`, durationMs: 4000 });
      void ipc.updateSettings({ firstRunDone: true });
    }

    this.isRunning = true;
    this.lastTickTime = performance.now();

    // Apply persisted scale (and mini-mode) once at startup
    await this.applyScale();

    this.loop();
  }

  /** Push the effective window scale (user scale × mini-mode 0.5×) to Rust. */
  private async applyScale(): Promise<void> {
    const effective = this.settings.miniMode ? this.settings.scale * 0.5 : this.settings.scale;
    await ipc.setWindowScale(effective);
    // Re-show in case a scale change raced with the window state, and refresh
    void ipc.getStage().then((stage) => {
      this.stage = stage;
    });
  }

  private loop = () => {
    if (!this.isRunning) return;

    const now = performance.now();
    const dtMs = Math.min(100, now - this.lastTickTime);
    this.lastTickTime = now;

    this.tick(dtMs);

    // Gate to fpsCap
    const targetIntervalMs = 1000 / this.settings.fpsCap;
    setTimeout(() => {
      requestAnimationFrame(this.loop);
    }, Math.max(0, targetIntervalMs - (performance.now() - now)));
  };

  private tick(dtMs: number) {
    const dtSec = dtMs / 1000;
    const now = performance.now();

    // Process inputs
    const pointerEvents = this.pointerTracker.pollEvents();
    const cursorInfo = this.cursorProcessor.process(
      this.lastCursorPayload,
      { x: this.stage.window.x, y: this.stage.window.y },
      this.settings.scale,
      this.stage.scaleFactor,
      dtMs
    );

    const stageInfo: StageInfo = {
      scale: this.settings.scale,
      scaleFactor: this.stage.scaleFactor,
      // "on ground" = window bottom is resting at the ground line (physical px)
      ground: Math.abs(this.stage.window.y - this.stage.groundY) < 4,
      nearTopEdge: this.stage.window.y < 30,
      window: this.stage.window,
    };

    // --- Poké Ball: grab (press on it) / throw (release with motion) ---
    const pointerHeld = this.pointerTracker.isPointerHeld();
    if (this.activeBall) {
      if (this.ballGrab && !pointerHeld) {
        // Released: throw with the pointer's recent velocity
        const ball = this.activeBall;
        ball.grabbed = false;
        ball.vx = Math.max(-520, Math.min(520, this.ballGrab.vx));
        ball.vy = Math.max(-620, Math.min(620, this.ballGrab.vy));
        this.ballGrab = null;
        this.audioManager.play("pop");
        this.engine.chaseBall(this.stage.window.x + ball.x * this.stage.scaleFactor);
      } else if (this.ballGrab) {
        // Held: the ball rides the pointer
        const pos = this.pointerTracker.getLastPointerPos();
        const dtSec = Math.max(0.001, (now - this.lastBallTrackMs) / 1000);
        this.ballGrab.vx = (pos.x - this.lastBallTrackPos.x) / dtSec;
        this.ballGrab.vy = (pos.y - this.lastBallTrackPos.y) / dtSec;
        this.lastBallTrackPos = { x: pos.x, y: pos.y };
        this.lastBallTrackMs = now;
        const b = this.activeBall;
        b.x = Math.max(b.r + 4, Math.min(256 - b.r - 4, pos.x));
        b.y = Math.max(b.r + 6, Math.min(242, pos.y + b.r));
      } else if (pointerHeld && !this.prevPointerHeld) {
        // Pressed: near the ball? grab it.
        const down = this.pointerTracker.getLastDownPos();
        const b = this.activeBall;
        if (!b.grabbed && dist(down.x, down.y, b.x, b.y - b.r) < 20) {
          this.ballGrab = { vx: 0, vy: 0 };
          b.grabbed = true;
          b.vx = 0;
          b.vy = 0;
          this.lastBallTrackPos = { ...down };
          this.lastBallTrackMs = now;
        }
      }
      // Drop the reference once the particle dies in the pool
      if (!this.ballGrab && this.activeBall.life >= this.activeBall.maxLife) {
        this.activeBall = null;
      }
    }
    this.prevPointerHeld = pointerHeld;

    if (this.ballGrab) {
      // While holding the ball, pointer gestures belong to the ball, not the pet
      pointerEvents.dragStart = false;
      pointerEvents.dragEnd = false;
      pointerEvents.clicks = [];
      pointerEvents.pettingActive = false;
    }

    // Engine update
    const outputs = this.engine.update(dtSec, {
      cursor: cursorInfo,
      pointer: pointerEvents,
      presence: {
        stillMs: this.stillMs,
        returned: this.presenceReturned,
        systemResumed: false,
      },
      stage: stageInfo,
      settings: this.settings,
    });
    this.presenceReturned = false;

    // Apply animation & facing
    this.animator.play(outputs.animation);
    this.animator.setFacing(outputs.facing);
    const { soundCue } = this.animator.update(dtMs);
    if (soundCue) {
      this.audioManager.play(soundCue as any);
    }

    // Track how long the current animation has run (for code-based motion)
    const currentAnim = this.animator.getCurrentAnimation();
    if (currentAnim !== this.lastAnimName) {
      this.lastAnimName = currentAnim;
      this.animTimeSec = 0;
    } else {
      this.animTimeSec += dtSec;
    }

    // Keep the chase glued to a still-rolling thrown ball
    if (this.activeBall && !this.ballGrab) {
      this.engine.updateBallTarget(this.stage.window.x + this.activeBall.x * this.stage.scaleFactor);
    }

    // Play sounds from engine
    for (const s of outputs.sound) {
      this.audioManager.play(s.id, s.volumeScale);
    }

    // Spawn FX from engine
    for (const f of outputs.fx) {
      this.handleFx(f);
    }

    // Speech bubble
    if (outputs.bubble && this.settings.speechBubbles) {
      this.speechBubble.show(outputs.bubble);
    }
    this.speechBubble.update(dtMs);

    // Update particles
    this.particlePool.update(dtMs);

    // Surface emotes: blush blooms while kissing then fades; anger ramps
    // while the attention system has escalated to angry.
    if (outputs.state === "KISSING") {
      this.blush = Math.min(1, this.blush + dtMs / 300);
    } else {
      this.blush = Math.max(0, this.blush - dtMs / 2400);
    }
    const angerTarget = outputs.mood === "angry" ? 1 : 0;
    const angerRate = outputs.mood === "angry" ? dtMs / 500 : dtMs / 800;
    this.anger +=
      Math.sign(angerTarget - this.anger) * Math.min(Math.abs(angerTarget - this.anger), angerRate);

    // Code-based motion: bob, sway, petting lean, foot-tap, angry shake
    const motion = this.motionController.update({
      animation: currentAnim,
      animTimeSec: this.animTimeSec,
      timeSec: now / 1000,
      petting: outputs.state === "PETTING" || pointerEvents.pettingActive,
      angry: outputs.mood === "angry",
      grumpy: outputs.mood === "grumpy",
      reduceMotion: this.settings.reduceMotion,
      cursor: cursorInfo ? { x: cursorInfo.x, y: cursorInfo.y } : null,
    });

    // Render frame
    this.renderer.render(
      motion,
      (ctx) => this.particlePool.draw(ctx),
      (ctx) => this.speechBubble.draw(ctx, this.settings.scale, stageInfo.nearTopEdge),
      { blush: this.blush, anger: this.anger }
    );

    // Handle movement (Rust walks the window; re-issue while the engine wants motion)
    if (outputs.moveIntent) {
      void ipc.moveTo(outputs.moveIntent.targetX, outputs.moveIntent.speed, outputs.moveIntent.targetY);
      // occasional dust puffs while trotting
      if (now - this.lastDustTime > 400) {
        this.lastDustTime = now;
        const dir = outputs.facing === "right" ? -1 : 1;
        this.particlePool.spawn(new DustParticle(128 + dir * 30, dir));
      }
    }

    // Drag start/end -> Rust owns the window while grabbed
    if (pointerEvents.dragStart) {
      const grab = this.pointerTracker.getLastPointerPos();
      void ipc.beginDrag(grab.x, grab.y);
    }
    if (pointerEvents.dragEnd) {
      void ipc.endDrag();
    }

    // Right-click -> native context menu
    if (pointerEvents.rightClick) {
      void ipc.showContextMenu();
    }

    // Track user presence (stillness / return) for the sleep system
    if (this.lastCursorPayload) {
      const moved =
        this.lastCursorPayload.x !== this.lastCursorPos.x ||
        this.lastCursorPayload.y !== this.lastCursorPos.y;
      if (moved) {
        this.lastCursorPos = { x: this.lastCursorPayload.x, y: this.lastCursorPayload.y };
        this.stillMs = 0;
        if (now - this.lastMoveTime > 30000 && this.settings.wakeOnReturn) {
          this.presenceReturned = true;
        }
        this.lastMoveTime = now;
      } else {
        this.stillMs += dtMs;
      }
    }

    // Debounced state save (every 30 seconds)
    if (now - this.lastSavedTime >= 30000) {
      this.lastSavedTime = now;
      const state = this.engine.getNeeds().toState(Date.now());
      void ipc.savePetState(state);
    }
  }

  private handleMenuAction(action: string) {
    switch (action) {
      case "sleep":
        this.engine.forceSleep();
        break;
      case "wake":
        this.engine.forceWake();
        break;
      case "sleep_toggle": {
        // Context menu uses a single toggle item labelled by current state.
        if (this.engine.getState() === "SLEEPING") {
          this.engine.forceWake();
        } else {
          this.engine.forceSleep();
        }
        break;
      }
      case "mini":
        this.settings.miniMode = !this.settings.miniMode;
        void ipc.updateSettings({ miniMode: this.settings.miniMode });
        // Apply immediately: in browser dev mode there is no settings://changed
        // event to bounce back, and in Tauri the re-apply below is idempotent.
        void this.applyScale();
        break;
      case "mute":
        this.settings.soundEnabled = !this.settings.soundEnabled;
        this.audioManager.setMuted(!this.settings.soundEnabled);
        void ipc.updateSettings({ soundEnabled: this.settings.soundEnabled });
        break;
      case "hide":
        void ipc.hidePet();
        break;
      case "show":
        void ipc.showPet();
        break;
      case "throw_ball":
        this.throwUserBall();
        break;
      case "settings":
        // Rust opens the settings window directly
        break;
      case "quit":
        // Rust exits directly
        break;
    }
  }

  private handleFx(fx: FxSpawn) {
    if (fx.kind === "hearts") {
      if (fx.big) {
        for (const h of spawnKissHearts()) {
          this.particlePool.spawn(h);
        }
      } else {
        for (const h of spawnPettingBurst()) {
          this.particlePool.spawn(h);
        }
      }
    } else if (fx.kind === "zzz") {
      this.particlePool.spawn(new ZzzParticle(145, 120, Math.floor(Math.random() * 3)));
    } else if (fx.kind === "exclaim") {
      this.particlePool.spawn(new ExclamationParticle());
    } else if (fx.kind === "question") {
      this.particlePool.spawn(new QuestionParticle());
    } else if (fx.kind === "dust") {
      this.particlePool.spawn(new DustParticle(128, 1));
      this.particlePool.spawn(new DustParticle(128, -1));
    } else if (fx.kind === "laugh") {
      this.particlePool.spawn(new LaughParticle(150, 110, Math.floor(Math.random() * 6)));
    } else if (fx.kind === "note") {
      this.particlePool.spawn(new NoteParticle(150, 110, Math.floor(Math.random() * 6)));
    } else if (fx.kind === "ball") {
      // Engine-spawned ball: give it a little outward roll
      const dir = fx.x >= 128 ? 1 : -1;
      const ball = new BallParticle(fx.x, dir * (50 + Math.random() * 70), 8000);
      this.activeBall = ball;
      this.particlePool.spawn(ball);
    } else if (fx.kind === "ball_caught") {
      // Pika caught the user's ball: pop it away, then he dances (engine side)
      const b = this.activeBall;
      if (b && !b.grabbed) {
        const dir = b.x < 128 ? -1 : 1;
        b.vx = dir * (150 + Math.random() * 120);
        b.vy = -260;
        b.maxLife = Math.max(b.maxLife, b.life + 6000);
        this.audioManager.play("thud", 0.7);
      }
      this.motionController.land(0.8);
    }
  }

  /** Tray/context menu: toss a fresh Poké Ball for him to chase. */
  private throwUserBall() {
    if (this.activeBall) {
      this.activeBall.maxLife = this.activeBall.life + 300; // fade the old one fast
    }
    const dir = Math.random() < 0.5 ? -1 : 1;
    const ball = new BallParticle(128 + dir * 24, dir * (150 + Math.random() * 110), 20000);
    ball.vy = -140; // arcing toss
    this.activeBall = ball;
    this.particlePool.spawn(ball);
    this.audioManager.play("pop");
    this.engine.chaseBall(this.stage.window.x + ball.x * this.stage.scaleFactor);
  }
}
