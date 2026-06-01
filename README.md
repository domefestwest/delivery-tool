# Dome Festival Delivery Tool

> Universal H.265 10-bit delivery encoder for fulldome film festivals — config-driven, cross-platform, open source.

![Status](https://img.shields.io/badge/status-beta-orange) ![License](https://img.shields.io/badge/license-MIT-blue) ![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

A desktop app that takes a fulldome filmmaker's source files (PNG/EXR sequences or .mp4/.mov masters) and produces a correctly-encoded delivery package — H.265 10-bit, 30 or 60fps exact, with stems, MD5 checksums, output verification, and a self-describing report.

**Built originally for [Dome Fest West](https://domefestwest.com)**, this tool is now positioned as a community resource for **any fulldome film festival** worldwide. The encoding rules, allowed resolutions, frame rates, audio requirements, and delivery folder structure are all driven by a runtime JSON config file. Adopt the tool for your festival in an afternoon.

---

## Choose your role

- **🎬 Filmmaker submitting to a festival?** → Read [INSTALL.md](./INSTALL.md), then download the [latest installer](https://github.com/domefestwest/delivery-tool/releases/latest) for your OS.
- **🏛 Festival organizer adopting this tool for your fest?** → Read [FESTIVALS.md](./FESTIVALS.md) for the config schema and adoption checklist; see [`examples/`](./examples/) for starter configs.
- **🧑‍💻 Developer / contributor?** → Continue reading this document.

---

## What it does

Given an artist's source files, this tool:

1. **Validates the source** — detects PNG/EXR sequence patterns, scans for missing frames (FFmpeg silently substitutes previous frames on missing files — a notorious silent-failure mode), checks bit depth, classifies frame rates strictly (30 or 60 only — drop-frame is soft-warned and conformed; 24/25/48/50 hard-rejected).
2. **Encodes to spec** — libx265, 10-bit `yuv420p10le`, CRF 18, preset `slow`, with tuned x265-params. Optionally GPU-accelerated via VideoToolbox (macOS), NVENC/QSV/AMF (Windows), or NVENC/VA-API (Linux). Tested on a real Apple M4 Max producing 21× realtime vs 3× CPU.
3. **Validates the output** — probes the encoded file post-encode and surfaces any deviation from the requested spec (wrong codec, downgraded bit depth, mismatched resolution, drift in frame count).
4. **Processes audio** — accepts 6-stem 5.1, single interleaved 5.1 WAV, or stereo. Optionally splits, normalizes to 44.1kHz/24-bit PCM, optionally muxes into the video. Runs a proper EBU R 128 LUFS analysis on the full mix and flags out-of-spec loudness or true-peak clipping.
5. **Packages the delivery** — `{FilmTitle}_{FESTIVAL}{Year}/` containing `video/`, `audio/`, `delivery_report.txt` (with MD5 checksums and full provenance), and optionally a single `.zip` for upload portals.
6. **Stays useful while it works** — live progress bar with frame counter, encode-speed multiplier, ETA, live output file size, system-sleep prevention, and a desktop notification when done.

---

## Features at a glance

- ✅ Bundled static FFmpeg 8.1.1 with libx265 10-bit — no separate install
- ✅ Multi-resolution batch (encode 4K + 6K + 8K from one source in sequence)
- ✅ Project save/load (`.domeproj`) — pickup-where-you-left-off
- ✅ Recent encodes dropdown (replay settings from prior submissions)
- ✅ Drag-and-drop source files / folders / audio stems
- ✅ Auto-zip delivery package option
- ✅ Test encode (5-second preview, opens in default player) before committing to a 4-hour job
- ✅ Pre-flight disk-space check vs. estimated output size
- ✅ Festival deadline countdown in header (color-coded by urgency)
- ✅ Update notifications via GitHub Releases API
- ✅ Debug log export for support requests
- ✅ Keyboard shortcuts (⌘E encode, ⌘T test, ⌘S save, ⌘O open, Esc cancel)
- ✅ Cross-platform: macOS 10.15+, Windows 10+, Linux x86_64 with glibc 2.31+

---

## Festival adoption — the 30-second pitch

The tool ships with one festival config baked in — Dome Fest West's. But any festival can use it: write a JSON file describing your delivery requirements (allowed resolutions, frame rates, audio rules, encoding params, contact info, deadline), distribute that file to your artists along with the installer link, and they click **"Load festival config"** to switch the entire tool over to your festival's branding and rules.

See **[FESTIVALS.md](./FESTIVALS.md)** for the full schema, recommended encoding spec with rationale, and a distribution checklist. See **[`examples/`](./examples/)** for ready-to-edit starter configs.

---

## Development setup

```bash
# Prerequisites: Node.js 20+, npm, git, git-lfs

git clone https://github.com/domefestwest/delivery-tool.git
cd delivery-tool

# Pull the bundled FFmpeg binaries from Git LFS
git lfs pull

npm install
npm run build
npm start
```

For hot-reload React development:

```bash
# Terminal 1
BROWSER=none npx react-scripts start

# Terminal 2
ELECTRON_START_URL=http://localhost:3000 npx electron .
```

---

## Building distribution installers

```bash
npm run dist:mac      # .dmg (x64 + arm64)
npm run dist:win      # .exe NSIS installer
npm run dist:linux    # .AppImage

npm run dist          # All platforms (requires platform-specific toolchains)
```

For automated releases via GitHub Actions, push to main (which auto-bumps the patch version), then trigger **Actions → "Release Installers" → Run workflow** to build all three installers and publish them to a tagged GitHub Release.

---

## Architecture

```
dome-festival-delivery-tool/
├── main.js                 # Electron main process — IPC handlers + lifecycle
├── preload.js              # contextBridge IPC exposure (no nodeIntegration)
├── dfw_config.json         # Default shipped festival config (DFW)
├── examples/               # Starter configs for other festivals
├── ffmpeg/
│   ├── mac/                # Static FFmpeg+FFprobe (evermeet.cx)
│   ├── win/                # Static FFmpeg+FFprobe (gyan.dev)
│   └── linux/              # Static FFmpeg+FFprobe (johnvansickle)
├── src-main/               # Main-process pure modules (cross-platform, testable)
│   ├── platform.js         # Single source of truth for platform decisions
│   ├── ffmpeg-capabilities.js  # Binary probing
│   ├── gpu-detection.js    # GPU encoder discovery
│   ├── dependency-check.js # Orchestrates bundled → system fallback → GPU
│   ├── encode-args.js      # Pure builder of FFmpeg argv arrays
│   ├── audio-processor.js  # Stems + 5.1 channelsplit + mux temp-replace
│   ├── delivery-report.js  # Report text builder
│   ├── gap-detector.js     # Missing-frame detection in image sequences
│   ├── output-estimate.js  # Bitrate table → predicted file size
│   ├── disk-space.js       # fs.statfs wrapper + tight/insufficient classifier
│   ├── output-verification.js  # Post-encode probe vs spec
│   ├── loudness.js         # EBU R 128 LUFS analysis
│   ├── settings-store.js   # userData JSON persistence
│   ├── project-io.js       # .domeproj save/load
│   ├── preview-generator.js  # FFmpeg thumbnail extraction
│   ├── zip-package.js      # System-native zip wrapper
│   ├── update-checker.js   # GitHub Releases API client
│   └── utils.js            # formatBytes, formatDuration, MD5, etc.
├── src/                    # React renderer
│   ├── App.jsx             # Root component + global state
│   ├── App.css             # Design tokens + layout
│   └── components/
│       ├── FestivalHeader.jsx
│       ├── OnboardingScreen.jsx
│       ├── SourcePreview.jsx    # Drop zone + thumbnail + info chips
│       ├── SettingsPanel.jsx    # FILM / OUTPUT / AUDIO / ENCODER sections
│       ├── EncodeAction.jsx     # Pre-flight + encode + progress + results
│       └── AudioInput/
│           ├── StemSelector.jsx
│           └── InterleaveSelector.jsx
├── test/
│   └── cross-platform.test.js   # 98 unit tests covering all pure modules
├── .github/workflows/
│   ├── ci.yml              # Tests + React build on every push
│   ├── version-bump.yml    # Auto patch-bump on push to main
│   └── release.yml         # Manual-trigger installer builds + publish
├── INSTALL.md              # For artists
├── FESTIVALS.md            # For festival organizers
└── package.json
```

---

## Cross-platform test suite

```bash
npm test
```

Runs 98 pure-function unit tests covering platform path resolution, FFmpeg arg generation, GPU encoder tables, loudness classification, version comparison, settings persistence, gap detection, output verification, and more. Tests run by passing platform strings as arguments — so the same machine validates Mac, Windows, and Linux behavior simultaneously.

CI runs the test suite on every push (without downloading LFS binaries, since pure-function tests don't need them).

---

## License

**MIT** — Copyright © 2027 Dome Festival Delivery Tool contributors.

Use it freely, fork it freely, adapt it for your festival, commercial or otherwise. No royalty, no attribution required (though appreciated — a credit on your festival's submissions page helps other festivals discover the tool).

---

## Acknowledgments

- **Originally built for [Dome Fest West](https://domefestwest.com)** by Ryan, with extensive iteration to harden the encoding pipeline against real-world fulldome submission failure modes.
- **Bundled FFmpeg binaries** courtesy of [evermeet.cx](https://evermeet.cx/ffmpeg/) (macOS), [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) (Windows), and [johnvansickle.com](https://johnvansickle.com/ffmpeg/) (Linux).
- **Electron + React + electron-builder** as the cross-platform foundation.

---

## Get involved

- **Issues / bugs / feature requests** → [GitHub Issues](https://github.com/domefestwest/delivery-tool/issues)
- **Adopting this for your festival?** → Open an issue or email **Ryan@domefestwest.com**. Happy to help validate your config or debug delivery issues.
- **PRs welcome.** Tests must pass (`npm test`) and the React build must be clean (`npm run build`).
