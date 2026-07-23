# Developing on the Dome Festival Delivery Tool

This is the developer guide. If you're a filmmaker or festival organizer, see [README.md](./README.md) instead.

---

## Tech stack

- **Electron 28** (Chromium + Node)
- **React 18** for the renderer
- **electron-builder** for installers
- **No backend** — everything runs locally on the user's machine
- **FFmpeg** as the actual encoding engine (bundled per-platform)

The whole app is **~6,000 lines of code** plus ~3,000 lines of unit tests. No build step beyond `react-scripts build`. No native modules. No optional dependencies.

---

## Quick start

```bash
# Prerequisites: Node.js 20+, npm, git, git-lfs

git clone https://github.com/domefestwest/delivery-tool.git
cd delivery-tool

# Pull the bundled FFmpeg binaries from Git LFS (~300 MB)
git lfs pull

npm install
npm test       # 98 unit tests, all pure functions, no I/O
npm run build  # React production build
npm start      # Launch Electron
```

For hot-reload React development:

```bash
# Terminal 1
BROWSER=none npx react-scripts start

# Terminal 2
ELECTRON_START_URL=http://localhost:3000 npx electron .
```

---

## Architecture

The codebase is split into two halves around the Electron main/renderer boundary, with a strict rule: **all platform-specific decisions and all FFmpeg subprocess calls live in the main process**. The renderer is pure UI.

```
dome-festival-delivery-tool/
├── main.js                       # Electron main entry — IPC handlers + lifecycle
├── preload.js                    # contextBridge exposure (no nodeIntegration!)
├── presets/                      # Bundled festival presets (DFW + examples)
├── examples/                     # Starter configs for other festivals
├── ffmpeg/
│   ├── mac/                      # Static FFmpeg + FFprobe (evermeet.cx)
│   ├── win/                      # Static FFmpeg + FFprobe (gyan.dev)
│   └── linux/                    # Static FFmpeg + FFprobe (johnvansickle)
├── src-main/                     # Main-process pure modules — cross-platform, testable
│   ├── platform.js               # Single source of truth for OS decisions
│   ├── ffmpeg-capabilities.js    # Binary version + libx265 + 10-bit probing
│   ├── gpu-detection.js          # GPU encoder discovery (VideoToolbox/NVENC/QSV/AMF/VA-API)
│   ├── dependency-check.js       # Bundled → system fallback → GPU detection
│   ├── encode-args.js            # Pure builder of FFmpeg argv arrays (≈100% test-covered)
│   ├── audio-processor.js        # Stems + 5.1 channelsplit + temp-replace mux
│   ├── delivery-report.js        # delivery_report.txt builder
│   ├── gap-detector.js           # Missing-frame detection in image sequences
│   ├── output-estimate.js        # Bitrate table → predicted file size
│   ├── disk-space.js             # fs.statfs + ok/tight/insufficient classifier
│   ├── output-verification.js    # Post-encode probe vs requested spec
│   ├── loudness.js               # EBU R 128 LUFS analysis (proper mix, not just stems[0])
│   ├── settings-store.js         # userData JSON persistence + legacy migration
│   ├── project-io.js             # .domeproj save/load (.dfwproj also accepted)
│   ├── preview-generator.js      # FFmpeg thumbnail extraction → base64 data URL
│   ├── zip-package.js            # System-native zip wrapper (Unix zip / PowerShell)
│   ├── update-checker.js         # GitHub Releases API client + semver compare
│   └── utils.js                  # formatBytes, formatDuration, MD5, ETA
├── src/                          # React renderer
│   ├── App.jsx                   # Root component + global state
│   ├── App.css                   # Design tokens + 2-column layout
│   └── components/
│       ├── FestivalHeader.jsx
│       ├── OnboardingScreen.jsx
│       ├── SourcePreview.jsx     # Drop zone + thumbnail + info chips + frame-rate selector
│       ├── SettingsPanel.jsx     # FILM / OUTPUT / AUDIO / ENCODER sections in one card
│       ├── EncodeAction.jsx      # Pre-flight + encode + progress + results
│       └── AudioInput/
│           ├── StemSelector.jsx
│           └── InterleaveSelector.jsx
├── test/
│   └── cross-platform.test.js    # 98 unit tests covering all pure modules
├── .github/workflows/
│   ├── ci.yml                    # Tests + React build on every push
│   ├── version-bump.yml          # Auto patch-bump on push to main
│   └── release.yml               # Manual-trigger installer builds + publish
├── INSTALL.md                    # For filmmakers (installation guide)
├── FESTIVALS.md                  # For festival organizers (config schema + adoption)
└── DEVELOPING.md                 # This file
```

### Design rules

These are enforced by code review and (where possible) by tests:

1. **No `process.platform` checks outside `src-main/platform.js`** — single source of truth
2. **No FFmpeg calls outside `src-main/*` modules** — main.js delegates, doesn't implement
3. **All paths via `path.join()` / `path.resolve()`** — no string concatenation. Tested via static grep in `test/cross-platform.test.js`
4. **Pure functions where possible** — encode-args, gap-detector, output-verification, loudness classifier, and version comparator are all I/O-free and 100% unit-tested
5. **No `nodeIntegration` in renderer** — preload exposes a single `window.api` namespace via `contextBridge`
6. **No new npm dependencies without justification** — current dev deps are React + electron + electron-builder + concurrently + wait-on. That's it.

---

## Cross-platform testing

```bash
npm test
```

98 unit tests covering:

- Platform predicates and path resolution (every function accepts a platform string so the same machine validates Mac/Win/Linux behavior)
- FFmpeg argument generation across CPU/GPU × PNG/video × 4K/6K/8K × 30/60fps × 8/16-bit
- GPU encoder candidate tables (priority, profiles, requiresSystemFFmpeg flags)
- Audio arg builders (channelsplit, mux, normalize)
- Gap detection in image sequences
- Output size estimation and verification
- LUFS classification
- Settings persistence with legacy file migration
- Version comparison for the update checker

Tests are **pure-function only** — they don't spawn FFmpeg or touch real files except in a `/tmp` test directory cleaned up between runs. CI runs them on every push (without downloading LFS binaries, since pure-function tests don't need them).

When adding new pure modules, add tests. When adding I/O-heavy logic, factor out the pure parts and test those.

---

## Manual debugging without clicking through the UI

Two scripts exist purely for fast iteration while debugging — neither is part of the shipped app.

### `scripts/devtest.js` — headless CLI

Talks directly to the same `src-main/*.js` modules the app uses — no Electron window, no IPC, instant feedback. Good for checking "what would the tool actually do here" without going through the UI.

```bash
npm run devtest -- presets                              # list bundled festival presets
npm run devtest -- preset dfw-2027                       # dump one preset's full config
npm run devtest -- resolution 8192 8192 dfw-2027         # what output resolutions does this source allow?
npm run devtest -- encode-args dfw-2027 4K 30 --gpu       # print the exact ffmpeg argv (dry run, no ffmpeg spawned)
npm run devtest -- verify ~/Desktop/Some_Delivery_Folder  # run Festival Verify Mode against a real folder
npm run devtest -- report dfw-2027 4K 30                  # print a sample delivery_report.txt
npm run devtest -- md5 ~/Desktop/some_big_file.mp4        # compute MD5 with live progress
npm run devtest -- gpu darwin hevc                        # show GPU encoder candidates for a platform
npm run devtest:all                                       # run everything above as one smoke test
```

Exit code is 0 on success, 1 if any check fails — safe to chain in a shell script.

### `scripts/screenshot-sizes.js` — window-size / CSS regression check

Launches the **real app** (same `main.js`, same IPC handlers as `npm start`) and resizes its window through a handful of sizes — including the app's declared 860×640 minimum — screenshotting each and flagging horizontal overflow (a proxy for "something is clipped or forcing an unwanted scrollbar").

```bash
npm run devtest:screenshots                        # all sizes: min, default, laptop, large, ultrawide, tall-narrow
npm run devtest:screenshots -- --sizes=min,large    # just specific ones
```

Output lands in `devtest-output/` (gitignored). Note: on macOS, programmatic window resizing can trigger a transient native "size HUD" overlay that gets baked into the screenshot if captured too soon after resize — the script waits 1.5s after each resize before capturing to let it fade. If you see a gray pill with dimensions in a screenshot, that's the OS, not the app.

---

## Building distribution installers

```bash
npm run dist:mac      # .dmg (x64 + arm64, unsigned)
npm run dist:win      # .exe NSIS installer (unsigned)
npm run dist:linux    # .AppImage

npm run dist          # All platforms (requires platform-specific toolchains)
```

The local Mac build has been verified end-to-end: produces a working `.dmg` with bundled FFmpeg correctly resolved from `Contents/Resources/`.

For automated releases via GitHub Actions:

1. Push to main → auto-version-bump workflow bumps patch and tags
2. Go to **Actions → "Release Installers" → Run workflow**
3. Build matrix runs in parallel on macos-latest, windows-latest, ubuntu-latest
4. Artifacts upload to a GitHub Release tagged with the current `package.json` version
5. Pre-release flag defaults to true (we're in 0.x)

The release pipeline disables code signing (`CSC_IDENTITY_AUTO_DISCOVERY: false`) — adding proper signing certificates is a future task.

---

## Conventions

### Commit messages

Format: `type: short summary`

Common types: `feat`, `fix`, `refactor`, `chore`, `docs`, `release`. Include a body for non-trivial changes explaining the *why*. Bottom: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` when AI-assisted.

The auto-version-bump workflow ignores any commit with `[skip ci]` in the message, so manual version changes can land without triggering the patch bump.

### Version policy

We're in 0.x — every minor version bump signals a stabilization milestone, every patch is a small feature or fix. Once a festival adopts the tool in production we'll consider 1.0.

### File / module naming

- React components: PascalCase (`EncodeAction.jsx`)
- Main-process modules: kebab-case (`gpu-detection.js`)
- Pure functions exported by name: camelCase
- Constants: UPPER_SNAKE_CASE
- Test files: `*.test.js`

---

## Adding a new feature

A rough checklist for non-trivial features:

1. **Decide where it lives** — Is it a pure function (add to `src-main/`)? Renderer UI (add a component or modify one)? Both (write the pure function first, then wire it to IPC + UI)?
2. **Write tests for the pure parts** — `test/cross-platform.test.js` is one big file; just append a `section()` and some `test()` blocks
3. **Wire to IPC** if the renderer needs it: add an `ipcMain.handle()` in `main.js`, then expose via `preload.js`
4. **Surface in the UI** — keep the UI compact; reuse existing components and chip/card patterns from `App.css`
5. **Run `npm test` and `npm run build`** before committing — both must pass cleanly
6. **Update docs if user-visible** — README, INSTALL, FESTIVALS, or example configs as appropriate

---

## Known limitations

- **Unsigned installers** trigger a one-time security warning on first launch (Mac Gatekeeper, Windows SmartScreen). Documented bypass in [INSTALL.md](./INSTALL.md).
- **Linux GPU encoding via bundled FFmpeg** — the johnvansickle static build doesn't include NVENC/VA-API. Linux users wanting GPU acceleration need to install their distro's FFmpeg; the dependency-check picks it up via system-fallback.
- **No `electron-updater`** — we have a polling update checker that surfaces a "new version available" badge linking to the release page. Auto-download/install would be a future feature.
- **No code signing** — needs a paid Apple Developer account + Windows EV certificate. Worth doing once we have funded adoption.

---

## License

MIT. See [LICENSE](./LICENSE).
