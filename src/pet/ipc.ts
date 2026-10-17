import type {
  PetState,
  Settings,
  Stage,
  CursorTickPayload,
} from "../shared/types";

let tauriInvoke: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null = null;
let tauriListen: (<T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>) | null = null;

/**
 * Resolve the Tauri bindings exactly once, shared by every ipc call site.
 *
 * The bindings arrive through a dynamic import, so on first boot `getSettings`
 * (called straight from DOMContentLoaded) could run while the import was still
 * in flight and silently fall back to browser defaults. In the real app that
 * skipped the first-run greeting and later persisted settings against a stale
 * base (firstRunDone=false while miniMode=true). Awaiting this promise before
 * touching tauriInvoke makes the first call deterministic.
 */
function ensureTauri(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        try {
          const core = await import("@tauri-apps/api/core");
          const event = await import("@tauri-apps/api/event");
          tauriInvoke = core.invoke;
          tauriListen = event.listen;
        } catch {
          // Running in browser dev mode without Tauri
        }
      }
    })();
  }
  return initPromise;
}
let initPromise: Promise<void> | null = null;
// Kick the import off at module load; callers still await it before use.
void ensureTauri();

export const ipc = {
  async getSettings(): Promise<Settings> {
    // Choke point: every window (pet + settings) loads its settings first, so
    // awaiting init here guarantees all later calls see the real bindings.
    await ensureTauri();
    if (tauriInvoke) {
      try {
        return await tauriInvoke<Settings>("get_settings");
      } catch (e) {
        console.warn("get_settings error:", e);
      }
    }
    // Fallback defaults
    return {
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
      // Mirror the Rust default: a fresh session greets (so the browser-dev
      // harness exercises the same first-run path as the real app).
      firstRunDone: false,
      attentionDelaySec: 120,
      debugFastAttention: false,
    };
  },

  async updateSettings(patch: Partial<Settings>): Promise<Settings | null> {
    if (tauriInvoke) {
      try {
        return await tauriInvoke<Settings>("update_settings", { patch });
      } catch (e) {
        console.warn("update_settings error:", e);
      }
    }
    return null;
  },

  async getPetState(): Promise<PetState | null> {
    if (tauriInvoke) {
      try {
        return await tauriInvoke<PetState>("get_pet_state");
      } catch (e) {
        console.warn("get_pet_state error:", e);
      }
    }
    return null;
  },

  async savePetState(state: PetState): Promise<void> {
    if (tauriInvoke) {
      try {
        await tauriInvoke("save_pet_state", { newState: state });
      } catch (e) {
        console.warn("save_pet_state error:", e);
      }
    }
  },

  async getStage(): Promise<Stage> {
    if (tauriInvoke) {
      try {
        return await tauriInvoke<Stage>("get_stage");
      } catch (e) {
        console.warn("get_stage error:", e);
      }
    }
    return {
      monitors: [],
      activeMonitorId: 0,
      scaleFactor: 1.0,
      window: { x: 400, y: 700, width: 256, height: 256 },
      groundY: 700,
      feetYLogical: 242,
    };
  },

  async setHitbox(rect: { x: number; y: number; width: number; height: number } | null): Promise<void> {
    if (tauriInvoke) {
      try {
        await tauriInvoke("set_hitbox", { rect });
      } catch {}
    }
  },

  async setWindowScale(scale: number): Promise<void> {
    if (tauriInvoke) {
      try {
        await tauriInvoke("set_window_scale", { scale });
      } catch {}
    } else {
      // Browser dev: there is no OS window to resize — emulate it on the
      // canvas so scale / mini mode stay visually testable (the renderer's
      // ResizeObserver picks the new CSS size up).
      const canvas = document.getElementById("pet-canvas") as HTMLCanvasElement | null;
      if (canvas) {
        const px = `${Math.round(256 * scale)}px`;
        canvas.style.width = px;
        canvas.style.height = px;
      }
    }
  },

  async moveTo(x: number, speed: number, y?: number): Promise<void> {
    if (tauriInvoke) {
      try {
        await tauriInvoke("move_to", { x, speed, y: y ?? null });
      } catch {}
    }
  },

  async stopMove(): Promise<void> {
    if (tauriInvoke) {
      try {
        await tauriInvoke("stop_move");
      } catch {}
    }
  },

  async setCursorRate(mode: "active" | "idle" | "sleep" | "off"): Promise<void> {
    if (tauriInvoke) {
      try {
        await tauriInvoke("set_cursor_rate", { mode });
      } catch {}
    }
  },

  async onCursorTick(callback: (payload: CursorTickPayload) => void): Promise<() => void> {
    if (tauriListen) {
      try {
        return await tauriListen<CursorTickPayload>("cursor://tick", (e) => callback(e.payload));
      } catch {}
    }
    return () => {};
  },

  async onSettingsChanged(callback: (settings: Settings) => void): Promise<() => void> {
    if (tauriListen) {
      try {
        return await tauriListen<Settings>("settings://changed", (e) => callback(e.payload));
      } catch {}
    }
    return () => {};
  },

  async onMenuAction(callback: (action: string) => void): Promise<() => void> {
    if (tauriListen) {
      try {
        return await tauriListen<{ action: string }>("menu://action", (e) => callback(e.payload.action));
      } catch {}
    }
    return () => {};
  },

  async onArrived(callback: (pos: { x: number; y: number }) => void): Promise<() => void> {
    if (tauriListen) {
      try {
        return await tauriListen<{ x: number; y: number }>("pet://arrived", (e) => callback(e.payload));
      } catch {}
    }
    return () => {};
  },

  async onLanded(callback: (pos: { x: number; y: number }) => void): Promise<() => void> {
    if (tauriListen) {
      try {
        return await tauriListen<{ x: number; y: number }>("pet://landed", (e) => callback(e.payload));
      } catch {}
    }
    return () => {};
  },

  async onMoved(callback: (pos: { x: number; y: number }) => void): Promise<() => void> {
    if (tauriListen) {
      try {
        return await tauriListen<{ x: number; y: number }>("pet://moved", (e) => callback(e.payload));
      } catch {}
    }
    return () => {};
  },

  async beginDrag(grabX: number, grabY: number): Promise<void> {
    if (tauriInvoke) {
      try {
        await tauriInvoke("begin_drag", { grabX, grabY });
      } catch {}
    }
  },

  async endDrag(): Promise<void> {
    if (tauriInvoke) {
      try {
        await tauriInvoke("end_drag");
      } catch {}
    }
  },

  async showContextMenu(): Promise<void> {
    if (tauriInvoke) {
      try {
        await tauriInvoke("show_context_menu");
      } catch {}
    }
  },

  async showPet(): Promise<void> {
    if (tauriInvoke) {
      try {
        await tauriInvoke("show_pet");
      } catch {}
    }
  },

  async hidePet(): Promise<void> {
    if (tauriInvoke) {
      try {
        await tauriInvoke("hide_pet");
      } catch {}
    }
  },
};
