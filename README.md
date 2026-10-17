# ⚡ Pikachu Desktop Pet

### A tiny Pikachu-style companion that lives on your desktop.

A lightweight virtual pet for **Windows and macOS**, built as a private gift. It isn't an animated image — it watches your cursor, leans into a pet, blows a kiss, chases and pounces on a thrown Poké Ball, yawns, and eventually curls up and falls asleep. Local-first: no account, no cloud, no network, no API keys.

> Not an app you use. A little companion that lives on your computer.

## Features

- Transparent, borderless, always-on-top pet that walks and runs along the bottom of your screen
- Click-through everywhere except on the character itself
- Eyes/head follow your cursor; he notices you and chases fast mouse movement
- Pet him (stroke the cursor over his head) — he leans in and smiles
- Click his face: he blushes, a soft kiss sound plays, and a floating **"Ishq❤️"** speech bubble appears
- Happy dance: hops and sways when petted, kissed, or after he catches the ball — with squash-and-stretch on every landing
- **Poké Ball**: grab it (press on the ball) and throw it — gravity, bounces and rolling on the ground; he chases, pounces, then dances. Also available as *Throw Poké Ball* in the tray/context menu
- Lazy behaviours: random yawns, stretches, flopping down; after long idle he sleeps (belly-down sprite, floating Zzz) and wakes when your cursor comes near
- **Attention system**: after ~2 minutes without interaction he gets grumpy (side-eye, foot tap), then angry (angry sprite, body shake, red glowing cheeks with zigzag electric sparks drawn in canvas). Petting, a kiss, or the ball calms him down. The timer is configurable in settings, with a debug option that shrinks it to 10 seconds
- Soft synthesized sounds with volume and mute
- First-launch greeting `Hi,[Pikachu]!` — the name is set in settings
- Settings window, tray/menu-bar control, global show/hide shortcut `Cmd+Shift+P` (macOS) / `Ctrl+Shift+P` (Windows)
- Start with your computer, low-power mode, adjustable size

## Design principle

> **Cute first. Lightweight second. Features third.**
> Every feature must answer: *"Does this make him feel more alive?"*

## Tech stack

Tauri 2 · Rust · TypeScript · Vite · Canvas 2D · Vitest · Python asset tooling

## Install (unsigned builds)

Grab the installer from the **Actions → macOS DMG (universal)** workflow artifact, or from **Releases**.

- **Windows:** run the `.exe`; if SmartScreen appears choose *More info → Run anyway*.
- **macOS (Apple Silicon and Intel, universal .dmg):**
  1. Open the `.dmg` and drag **Pikachu** to `/Applications`.
  2. The app is **unsigned** (kept that way on purpose), so right-click → **Open** the first time and confirm — after that it launches normally.
  3. If Gatekeeper still blocks it, clear the quarantine flag:

     ```bash
     xattr -dr com.apple.quarantine /Applications/Pikachu.app
     ```

Known limitations: the pet does not appear over exclusive-fullscreen games or macOS full-screen Spaces. Linux is not supported.

## Develop

```bash
npm install
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r tools/requirements.txt
npm run tauri dev
```

Shortcuts in dev: `npm run typecheck`, `npm run test`, `cargo test` (in `src-tauri`).

## macOS builds

You develop on Windows, so the Mac build happens in CI: the **macOS DMG (universal)** workflow (`.github/workflows/macos-dmg.yml`) runs on `macos-latest`, builds a universal binary (aarch64 + x86_64) with `--target universal-apple-darwin`, and uploads the unsigned `.dmg` as a workflow artifact. Trigger it manually from the Actions tab or push a `v*` tag.

macOS transparency is enabled via `macOSPrivateApi` in `tauri.conf.json` plus the `macos-private-api` Cargo feature.

## Art

Character sprites (idle, jump, sleep, angry, Poké Ball) were extracted from reference images with `tools/prepare_ishq_sprites.py` into `public/assets/ishq/`. Animations, frame counts and timings are defined **once** in `assets/spec/animations.spec.json`; code and validators are generated from it (`npm run assets:spec`). Missing frames (walk, kiss, …) are substituted at runtime with code-based motion — bob, sway, squash/stretch — in `src/pet/render/motion.ts`.

There is **no image-generation step and no API key** involved anywhere in the pipeline.

## Docs

`docs/00-MASTER-PROMPT.md` (start here) → `01-PRD` → `02-TRD` → `03-APP-FLOW` → `04-UI-UX-ART-BIBLE` → `05-DATA-AND-IPC-CONTRACT` → `06-IMPLEMENTATION-PLAN` → `07-ASSET-PIPELINE`.

> Note: the docs predate this gift rebrand and still mention the old Nano Banana generation path; that path has been removed (no network, no keys).

## Privacy

No login, no camera, no microphone, no location, no network at runtime. Cursor position is used in memory only and is never stored or transmitted.

## License

MIT (default assumption — change before first release if you prefer another license).
