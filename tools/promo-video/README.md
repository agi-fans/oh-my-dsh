# Oh My DSH Promo Video

Standalone Remotion project for rendering the Oh My DSH promotional video (`72s`, `1920×1080`, `60 fps`, bilingual English/Chinese overlay titles with unified English TUI capture).

## Repository Isolation

This directory is intentionally outside the root `pnpm-workspace.yaml` (`packages/*/*` and `apps/*`) and carries its own `pnpm-workspace.yaml` and `.gitignore`. Root builds, tests, typechecks, and published npm packages (`@agi-fans/oh-my-dsh`, `@agi-fans/dsh-tui`) never depend on or bundle anything under `tools/promo-video/`.

Generated assets (`src/data/*.json`, `public/media/`, and `out/`) are gitignored so rendered videos, audio files, and captured frame buffers never pollute Git history.

## Prerequisites

- Repository dependencies installed at the repo root (`pnpm install` from the root directory).
- `ffmpeg` available on `PATH` for audio mastering and `+faststart` MP4 muxing.
- A local Chromium-based browser (Chrome, Edge, or Chromium) or Remotion's managed Chromium. Override with `REMOTION_BROWSER_EXECUTABLE` if needed.

## Usage

Run all commands from `tools/promo-video/`:

```sh
cd tools/promo-video
pnpm install
pnpm run prepare:assets
```

`pnpm run prepare:assets` runs three deterministic generators:

1. `pnpm run capture:live` — launches the real `omdsh` binary in an isolated temporary `OMDSH_HOME` over `node-pty` + `@xterm/headless` (including two real local stdio MCP demo servers), drives actual keystrokes, and writes `src/data/live-frames.json`.
2. `pnpm run capture:views` — invokes the real `renderView()` renderer from `packages/tui/omdsh-tui` for multi-turn and interactive transcript scenes, writing `src/data/real-frames.json`.
3. `pnpm run audio` — synthesizes the 72-second 120 BPM soundtrack and UI SFX, masters `public/media/soundtrack-72s.m4a` via `ffmpeg`, and removes the temporary WAV file.

Then preview interactively or render the final MP4 and poster into `out/`:

```sh
pnpm run studio
pnpm run still
pnpm run render
```

To remove all generated assets and render outputs:

```sh
pnpm run clean
```
