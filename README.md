# Dome Festival Delivery Tool

## Congratulations — your film was selected.

That's a real accomplishment. Fulldome festivals are competitive, and your work is about to be shown on a dome screen 15+ meters across, to an audience that came specifically to see it.

**This is the tool that will help you deliver your final master file** — properly encoded, validated, packaged exactly the way your festival needs it.

[**⬇️ Download the installer**](https://github.com/domefestwest/delivery-tool/releases/latest) · [Install guide](./INSTALL.md)

> Free, open-source, available for Mac, Windows, and Linux. No account required, no upload, runs entirely on your machine.

---

## Why you can trust this tool with your film

Under the hood, the tool uses **FFmpeg** — the industry-standard video encoder used by Netflix, YouTube, every major streaming service, and most professional film pipelines. We're not reinventing encoding. We're packaging FFmpeg with the exact settings each festival has approved, so you get every drop of quality your source has, in the format that plays back perfectly on dome systems.

**What that means for your film:**

| What the tool guarantees | Why it matters on the dome |
|---|---|
| **10-bit color depth** | Eliminates banding on smooth gradients — sky, space, washes — that's harshly visible on a 15m screen |
| **CRF 18 quality floor** | Visually lossless; your dome master keeps every detail of your source |
| **Exact frame rate (30 or 60fps)** | No drop-frame, no sync drift mid-show |
| **Source resolution enforced** | Never upscales — what comes in is what goes out, no fake high-resolution |
| **Audio normalized to broadcast standard** | Loudness checked against the festival's target (typically -23 LUFS) |
| **Every output verified post-encode** | If anything's off, you see it as a warning before you submit |
| **MD5 checksums in the delivery report** | Festival can verify the file arrived intact |

You don't have to understand the technical details — that's why the tool exists. But if you ever want to, the delivery report explains exactly how your film was encoded.

---

## Common things that go wrong (that this tool prevents)

Artists who encode their dome masters by hand often run into:

- 🌌 **Color banding on smooth gradients** caused by 8-bit color where the dome expects 10-bit
- ⏱ **Sync drift mid-show** caused by drop-frame rates (29.97 instead of 30) that look fine on a computer but slip on dome playback
- 🧊 **Frozen frames** caused by missing frames in PNG sequences that FFmpeg silently fills with the previous frame
- ❌ **Rejected submissions** because the codec, container, or audio format didn't match festival requirements
- 🔊 **Audio that's way too loud or too quiet** because it was mastered for headphones, not for the dome's loudness standard
- 📐 **Fake high-resolution files** when a smaller source was upscaled to make it "look 8K"

This tool prevents all of those, automatically, by encoding directly to your festival's exact spec and validating every step.

---

## How it works — the 30-second tour

1. **Pick your festival** from the Preset menu in the app header. The festival's spec loads automatically — right resolution, frame rate, codec, audio format.
2. **Drag in your film** — a folder of PNG or EXR frames, or your existing `.mp4`/`.mov` master. A thumbnail preview confirms you picked the right file.
3. **The tool tells you what to expect** — encode time, disk space needed, predicted file size, GPU acceleration if available.
4. **Click "Encode and Package"**. Progress bar, ETA, live file size update as it goes. Your computer stays awake. A notification fires when it's done.
5. **A delivery folder appears** with everything your festival needs:

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

Upload that folder (or its `.zip` — the tool can make one for you) to your festival's submission portal. Your work is on its way to the dome.

---

## Features that make your life easier

- 🎯 **Bundled festival presets** — your festival's spec is one click away, no separate config file to download
- 🎬 **Drag-and-drop everywhere** — source files, source folders, audio stems, watermark images
- 👁 **Live preview thumbnail** so you know you picked the right file
- ⚡ **GPU acceleration** when available — 5–20× faster than CPU on Apple Silicon, NVIDIA, Intel Quick Sync, AMD
- 🎬 **Test encode (5 seconds)** to verify your settings look right before committing to a multi-hour job
- 💾 **Save / open project** — step away from your work and come back to it exactly where you left off
- 🔄 **Multi-resolution batch** — encode 4K + 6K + 8K from one source in a single run
- 📦 **Auto-zip** the delivery folder for portals that want a single uploadable file
- 🛡 **Update notifications** — a discreet badge in the header tells you when a new version ships
- 🌗 **Stays awake during long encodes** so your Mac/PC doesn't sleep on you

---

## A note about screeners

If your festival also asks for a **screener** (a smaller file for jury preview, not for projection), the tool has an experimental mode for that too. A 2K H.264 file with optional watermark — fast to encode, easy to email or upload. Look for the **🎞 Screener** toggle at the top of the Settings panel.

---

## Get started

**[⬇️ Download the installer for your operating system](https://github.com/domefestwest/delivery-tool/releases/latest)**

The first time you open it on Mac or Windows, your operating system will show a security warning because this is a free, open-source build that isn't signed with a commercial developer certificate. The [**install guide**](./INSTALL.md) walks you through the one-time bypass — takes about 30 seconds.

After that, you're ready to encode.

---

## You don't have to figure this out alone

- **Questions about your festival's specific submission requirements?** Contact your festival's submission coordinator — they know their requirements best.
- **Tool isn't working as expected?** Use the **Save debug log** button in the error dialog and email it to **Ryan@domefestwest.com** or [open an issue on GitHub](https://github.com/domefestwest/delivery-tool/issues).
- **Want to share this with another filmmaker** who just got accepted somewhere? Please do. That's the whole point of this being free and open source.

---

## License + credits

**[MIT licensed](./LICENSE)** — free for any use, commercial or otherwise. Use it for your delivery, fork it, share it.

Originally built for **[Dome Fest West](https://domefestwest.com)** and battle-tested on real submissions. Bundled FFmpeg binaries courtesy of [evermeet.cx](https://evermeet.cx/ffmpeg/) (macOS), [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) (Windows), and [johnvansickle.com](https://johnvansickle.com/ffmpeg/) (Linux).

---

<details>
<summary>🏛 For festival organizers</summary>

If you run a fulldome festival and want to adopt this tool for your own submissions — your festival's encoding spec, your branding, your deadline — see **[FESTIVALS.md](./FESTIVALS.md)** for the config schema, recommended settings, and how to bundle your festival as a preset in the next release.
</details>

<details>
<summary>🧑‍💻 For developers</summary>

If you want to contribute code, see **[DEVELOPING.md](./DEVELOPING.md)** for setup, architecture, conventions, and the test suite.
</details>
