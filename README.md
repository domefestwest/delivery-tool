# Dome Fest West Delivery Tool

The official film delivery and encoding application for **Dome Fest West (DFW)**. Produces correctly encoded H.265 10-bit delivery packages for Fiske's SkySkan playback system.

Built on Electron + React. Designed for macOS, Windows, and Linux.

---

## For Artists

Download the latest installer from the DFW website. Run it, follow the prompts — the app ships with FFmpeg pre-bundled. No separate installation required.

If FFmpeg is missing or outdated (rare — see "Bundled FFmpeg" section below), the app will show a setup screen with platform-specific instructions.

---

## Bundled FFmpeg

The app ships with static FFmpeg binaries that include `libx265` with 10-bit support. These are checked on every launch.

| Platform | Source | Version | Bundled at |
|----------|--------|---------|-----------|
| **macOS** | [evermeet.cx](https://evermeet.cx/ffmpeg/) static build | 8.1.1 | `ffmpeg/mac/ffmpeg` + `ffmpeg/mac/ffprobe` |
| **Windows** | [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) full static build | — | `ffmpeg/win/ffmpeg.exe` |
| **Linux** | [johnvansickle.com](https://johnvansickle.com/ffmpeg/) static build | — | `ffmpeg/linux/ffmpeg` |

### Updating the bundled macOS binary

```bash
# Download latest FFmpeg static build for macOS (Apple Silicon + Intel universal)
curl -L "https://evermeet.cx/ffmpeg/ffmpeg-8.1.1.7z" -o /tmp/ffmpeg.7z
curl -L "https://evermeet.cx/ffmpeg/ffprobe-8.1.1.7z" -o /tmp/ffprobe.7z

# Extract (requires p7zip: brew install p7zip)
7z e /tmp/ffmpeg.7z -o ffmpeg/mac/
7z e /tmp/ffprobe.7z -o ffmpeg/mac/
chmod +x ffmpeg/mac/ffmpeg ffmpeg/mac/ffprobe

# Verify 10-bit libx265 support
./ffmpeg/mac/ffmpeg -h encoder=libx265 2>&1 | grep yuv420p10le
```

### Updating the bundled Windows binary

1. Go to [gyan.dev/ffmpeg/builds](https://www.gyan.dev/ffmpeg/builds/)
2. Download the **`ffmpeg-release-full-shared.7z`** or **full static** build
3. Extract `bin/ffmpeg.exe` and `bin/ffprobe.exe` into `ffmpeg/win/`
4. Verify: `ffmpeg\win\ffmpeg.exe -h encoder=libx265 | findstr yuv420p10le`

### Updating the bundled Linux binary

1. Go to [johnvansickle.com/ffmpeg](https://johnvansickle.com/ffmpeg/)
2. Download the **`ffmpeg-release-amd64-static.tar.xz`** archive
3. Extract `ffmpeg` and `ffprobe` into `ffmpeg/linux/`
4. Mark as executable: `chmod +x ffmpeg/linux/ffmpeg ffmpeg/linux/ffprobe`

> **Why static builds?** Static FFmpeg binaries include all dependencies — libx265, libx264, libvpx, etc. — in a single file. Artists don't need to install anything separately. The app verifies `yuv420p10le` support at runtime before using the binary.

---

## Encoding Quality

The core encoding requirement is **10-bit H.265 at CRF 18** to eliminate color banding on dome projection surfaces.

| Parameter | Value | Why |
|-----------|-------|-----|
| Codec | `libx265` | H.265/HEVC — required by SkySkan |
| Pixel format | `yuv420p10le` | 10-bit: 1024 steps per channel (vs 256 for 8-bit) |
| CRF | `18` | High quality floor — lower = better, never go above 20 |
| Preset | `slow` | Best compression quality; encode time is acceptable |
| x265-params | `bframes=8:ref=6:rd=6:subme=7:me=umh:b-adapt=2` | Tuned for quality |

**8K 60fps** additionally sets `vbv-maxrate=200000:vbv-bufsize=200000`.

---

## Development Setup

```bash
# Prerequisites: Node.js 18+, npm

git clone https://github.com/domefestwest/delivery-tool.git
cd delivery-tool
npm install

# Download bundled FFmpeg (macOS — see above for Windows/Linux)
curl -L "https://evermeet.cx/ffmpeg/ffmpeg-8.1.1.7z" -o /tmp/ff.7z && 7z e /tmp/ff.7z -o ffmpeg/mac/
curl -L "https://evermeet.cx/ffmpeg/ffprobe-8.1.1.7z" -o /tmp/fp.7z && 7z e /tmp/fp.7z -o ffmpeg/mac/
chmod +x ffmpeg/mac/ffmpeg ffmpeg/mac/ffprobe

# Build React and launch Electron
npm run build
npm start
```

### Dev mode (hot-reload React)

```bash
# Terminal 1: Start React dev server
BROWSER=none npx react-scripts start

# Terminal 2: Launch Electron pointed at dev server
ELECTRON_START_URL=http://localhost:3000 npx electron .
```

---

## Building Distribution Packages

```bash
# All platforms (requires cross-platform toolchain)
npm run dist

# macOS only (.dmg)
npm run dist:mac

# Windows only (.exe NSIS installer)
npm run dist:win

# Linux only (.AppImage)
npm run dist:linux
```

### macOS notarization

For public distribution, the app must be signed and notarized. Set these environment variables before building:

```bash
export APPLE_ID="your@appleid.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
npm run dist:mac
```

Without notarization, macOS will show a Gatekeeper warning. Artists can bypass it via **System Settings → Privacy & Security → "Open Anyway"**.

### Windows SmartScreen

Unsigned Windows builds trigger a SmartScreen warning on first launch. Artists click **"More info" → "Run anyway"**. Code signing with an EV certificate eliminates this. See [electron-builder code signing docs](https://www.electron.build/code-signing).

---

## Project Structure

```
dfw-delivery-tool/
  main.js               # Electron main process — all FFmpeg/file system calls
  preload.js            # contextBridge IPC bridge (no nodeIntegration in renderer)
  dfw_config.json       # Default DFW festival configuration
  ffmpeg/
    mac/ffmpeg          # Static FFmpeg binary (macOS, evermeet.cx)
    mac/ffprobe         # Static FFprobe binary (macOS, evermeet.cx)
    win/ffmpeg.exe      # Static FFmpeg binary (Windows, gyan.dev)
    linux/ffmpeg        # Static FFmpeg binary (Linux, johnvansickle.com)
  src/
    App.jsx             # Root React component — app state management
    App.css             # Design tokens and global styles
    components/
      FestivalHeader.jsx       # Header: festival name, config loader, FFmpeg status
      FilmInfo.jsx             # Film title + artist input fields
      OnboardingScreen.jsx     # Shown when FFmpeg is missing/broken
      EncodingSettings.jsx     # Resolution, output folder, audio section host
      EncodePanel.jsx          # Encode button, progress bars, completion + report
      SourceInput/
        SourceInput.jsx        # Tab switcher for PNG vs video source
        PNGSequenceTab.jsx     # PNG folder picker, pattern detection, bit depth
        VideoFileTab.jsx       # Video file picker, ffprobe display, fps validation
      AudioInput/
        AudioInput.jsx         # Audio mode selector (stems / interleaved / none)
        StemSelector.jsx       # 6-stem file picker with channel auto-detection
        InterleaveSelector.jsx # Single 5.1 WAV picker with ambisonic detection
  public/
    index.html
  package.json
```

---

## Festival Config Format

Any festival can distribute a `.json` config. Artists load it via "Load festival config" in the header. All encoding parameters, resolutions, frame rates, and delivery folder naming update immediately.

Minimum required fields match `dfw_config.json`. The `video.x265_params` and `video.crf` fields are read directly into the FFmpeg command — no hardcoded values in the app logic.

---

## License

MIT — Copyright © 2027 Dome Fest West

Questions? Contact [Ryan@domefestwest.com](mailto:Ryan@domefestwest.com) | [domefestwest.com](https://domefestwest.com)
