# Dome Festival Delivery Tool

**Encode your fulldome film for festival delivery — correctly, every time.**

A free desktop app for filmmakers and festivals. Drop in your image sequence or video master, get back a properly encoded H.265 file with synchronized audio, checksums, and a delivery report — ready to upload to the festival of your choice.

Used by **[Dome Fest West](https://domefestwest.com)** and designed to be adopted by any fulldome festival worldwide. Mac, Windows, and Linux. MIT licensed.

**[⬇️ Download installer](https://github.com/domefestwest/delivery-tool/releases/latest)** · [Filmmaker guide](./INSTALL.md) · [Festival organizer guide](./FESTIVALS.md)

---

## Who is this for?

### 🎬 You're a filmmaker submitting to a festival

Your festival should have given you their **config file** (a small `.json` file). Download the app, install it (one-time setup — see [INSTALL.md](./INSTALL.md) for bypassing the unsigned-beta warning), load your festival's config, drag in your film, hit encode. You'll get back a delivery folder ready to upload.

> **No video encoding knowledge required.** The tool enforces the right settings automatically.

### 🏛 You run a fulldome festival

Stop receiving wildly inconsistent submission files. Adopt this tool for your festival in an afternoon:

1. Copy one of the [example configs](./examples/) and edit it for your festival's requirements
2. Distribute the installer and your config to your submitting artists
3. Receive perfectly-encoded, self-documenting delivery packages

See [FESTIVALS.md](./FESTIVALS.md) for the full config schema and adoption checklist.

### 🧑‍💻 You're a developer

See [DEVELOPING.md](./DEVELOPING.md) for setup, architecture, and contribution guidelines.

---

## What you actually do with it

A filmmaker's workflow:

1. **Drag in your film** — a folder of PNG or EXR frames, or an `.mp4` / `.mov` file
2. **The tool previews your source** and detects bit depth, frame count, resolution, frame rate
3. **Your festival's settings are already loaded** (4K vs 8K, 30fps vs 60fps, audio format, etc.)
4. **Click Encode**
5. **A delivery folder appears** with everything the festival needs

That delivery folder looks like this:

```
Beyond_the_Dome_DFW2027/
├── video/
│   └── Beyond_the_Dome_DFW2027_8K.mp4      ← Encoded H.265, audio embedded
├── audio/
│   ├── Beyond_the_Dome_L.wav
│   ├── Beyond_the_Dome_R.wav
│   ├── Beyond_the_Dome_C.wav
│   ├── Beyond_the_Dome_LFE.wav             ← Individual 5.1 stems
│   ├── Beyond_the_Dome_Ls.wav
│   └── Beyond_the_Dome_Rs.wav
└── delivery_report.txt                      ← MD5 checksums, encoder info,
                                                source provenance, warnings
```

You upload that folder (or its `.zip`) to your festival's submission portal. Done.

---

## Why does this exist?

Fulldome festivals receive submissions in wildly inconsistent formats. The common failure modes are brutal:

- **Files encoded in formats the dome can't play back** — submissions rejected, artists scramble before deadline
- **8-bit color where 10-bit is required** — causes visible banding on smooth gradients (sky, space, gradients) on a 15-meter dome surface where every pixel is upscaled 1000×
- **Drop-frame timecodes** (29.97 instead of exactly 30fps) — cause sync drift on dome playback systems
- **Audio at the wrong sample rate or way too loud/quiet** — common rejection reason
- **Image sequences with missing frames** — FFmpeg silently duplicates the previous frame on missing files, which can ship a master with frozen-frame artifacts that nobody catches until dome day

These problems were eating hours of festival staff time and breaking submissions in front of audiences. This tool prevents all of them by encoding directly to the festival's exact requirements and validating every input and every output.

---

## What's in the box

### For filmmakers

| Feature | What it means for you |
|---|---|
| **Bundled FFmpeg 8.1.1** | Nothing extra to install |
| **GPU acceleration** | 5–20× faster than CPU on Apple Silicon, NVIDIA, Intel Quick Sync, AMD |
| **Drag-and-drop** | Source files, source folders, audio stems — drag them in anywhere |
| **Live preview** | Thumbnail of your source so you know you picked the right file |
| **Test encode (5 seconds)** | Verify your settings look right before committing to a 4-hour job |
| **Live progress + ETA** | Frame counter, encoding fps, time remaining, output size |
| **Save / open project** | `.domeproj` file captures your full setup — pick up where you left off |
| **Recent encodes list** | Replay settings from a prior submission with one click |
| **Multi-resolution batch** | Encode 4K + 6K + 8K from one source in sequence |
| **Auto-zip** | Optionally zip the delivery folder for portals that want a single file |
| **Stays awake** | Prevents your computer from sleeping during a long encode |
| **System notification** | Beep + desktop notification when the encode finishes |
| **Output verification** | Probes the encoded file post-encode to confirm it matches the festival's spec |
| **Loudness check** | EBU R 128 LUFS analysis on the full mix — catches the most common audio rejection reason before you submit |

### For festivals

| Feature | What it means for you |
|---|---|
| **JSON config file** | Define your encoding rules, allowed resolutions, frame rates, audio requirements |
| **Branded header** | Tool re-themes to show your festival's name, year, contact info |
| **Deadline countdown** | Optional color-coded countdown in the artist's app header |
| **MD5 checksums** | Every delivery includes them so you can verify file integrity |
| **Self-describing report** | Every submission ships with `delivery_report.txt` documenting encoder, source, warnings |
| **Audio/source validation** | Catches the most common mistakes before the file reaches you |

---

## Project status

**Beta** — stable architecture and feature set, in active testing with real submissions.

- ✅ Encoding pipeline: production-ready
- ✅ 98/98 cross-platform unit tests pass on every commit
- ⚠️ Installers are unsigned (one-time bypass on first launch — see [INSTALL.md](./INSTALL.md))
- ⚠️ Looking for festival adopters and filmmaker beta testers

---

## Help and contribute

- **Filmmakers** with delivery questions → contact your festival's submission coordinator
- **Festival organizers** considering adoption → email **Ryan@domefestwest.com**
- **Bug or feature suggestion** → [open an issue](https://github.com/domefestwest/delivery-tool/issues)
- **Want to contribute code** → see [DEVELOPING.md](./DEVELOPING.md)

---

## License and attribution

**[MIT](./LICENSE)** — use it freely, fork it freely, adapt it for your festival, commercial or otherwise.

Originally built for **[Dome Fest West](https://domefestwest.com)** with extensive iteration to harden the encoding pipeline against real-world fulldome submission failure modes.

Bundled FFmpeg binaries courtesy of [evermeet.cx](https://evermeet.cx/ffmpeg/) (macOS), [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) (Windows), and [johnvansickle.com](https://johnvansickle.com/ffmpeg/) (Linux).
