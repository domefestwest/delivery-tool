# For Festival Organizers — Configure the Tool for Your Fest

The **Dome Festival Delivery Tool** is an open-source tool designed for **any fulldome film festival**. Originally built for [Dome Fest West](https://domefestwest.com) and battle-tested on real submissions, it has been generalized so any festival can configure its own delivery requirements and brand the tool to its identity — no fork, no code changes, just a JSON config file.

If your submitting artists currently send you wildly inconsistent master files, this tool gives you a **free, branded, validated delivery pipeline** that artists install once and reuse for every submission.

This document is for **festival directors, technical leads, and submission coordinators** configuring the tool for their festival. (Filmmakers should read [INSTALL.md](./INSTALL.md) instead. Developers should read [README.md](./README.md).)

> 💡 **Starter configs are in [`examples/`](./examples/).** Copy any of them as a starting point — minimal, strict-8K-only, or DFW's production config.

---

## What artists get when you adopt this

When you give your artists this tool with your festival's config file, every submission you receive will be:

1. **Encoded to your exact spec** — your CRF, preset, x265 params, allowed resolutions and frame rates are enforced. No more "the file plays back wrong" debugging.
2. **Audio-validated** — LUFS loudness analysis, clipping warnings, 5.1 channel layout verification.
3. **Source-validated** — PNG/EXR gap detection (catches the silent-frozen-frame failure mode), bit-depth checks, frame-rate enforcement (no drop-frame, no PAL).
4. **Output-verified** — every encoded file is probed against your spec and any deviations (wrong codec, 8-bit instead of 10-bit, mismatched resolution) surface as warnings.
5. **Self-documenting** — every submission includes a `delivery_report.txt` with MD5 checksums, source provenance, encoder used, and any warnings that fired.
6. **Cleanly packaged** — `{Title}_FEST{Year}/` containing `video/`, `audio/`, `delivery_report.txt`, plus optional `.zip` for upload.

---

## Two ways to ship your config to artists

1. **Bundle into the app** (preferred). Open a PR adding your `{festival-short}-{year}.json` file to the `presets/` folder of [this repo](https://github.com/domefestwest/delivery-tool). Once merged into the next release, every artist who downloads the installer gets your preset in the **Preset** menu automatically — no extra download for them, no config file you have to host.

2. **Distribute alongside your submission instructions**. Host the `.json` on your festival's website, Google Drive, Dropbox, etc. Artists download it, then load via the app's **Preset → Custom → Load from file…** option. Use this if you don't want to wait for a release cycle, or if your config is festival-private.

Most festivals will want option 1 once they're settled. Option 2 is fine for early iteration.

---

## Architecture: how a festival adopts this

The whole tool is driven by **one JSON config file** that describes your festival's requirements. To support a different festival, you only need to:

1. Write a `{your-festival}_config.json` file (see schema below)
2. Distribute it to your artists alongside this tool's installer
3. Artists click **"Load festival config"** in the app header and pick your JSON file
4. The entire UI re-themes to your festival, your encoding rules apply, your contact info appears in the report

No code changes. No fork. The tool reads your config at runtime.

---

## Festival config file schema

Save as e.g. `superfest_config.json`. Every field shown below is required unless marked optional.

```json
{
  "festival_name": "SuperFest Planetarium Festival",
  "festival_short": "SUPER",
  "version": "2027",
  "contact_email": "deliveries@superfest.example",
  "website": "https://superfest.example",
  "festival_icon": "data:image/png;base64,iVBORw0KGgo...",
  "submission_deadline": "2027-08-31T23:59:59-07:00",
  "audio_target_lufs": -23,

  "video": {
    "codec": "libx265",
    "bit_depth": 10,
    "pix_fmt": "yuv420p10le",
    "crf": 18,
    "preset": "slow",
    "x265_params": "bframes=8:ref=6:rd=6:subme=7:me=umh:b-adapt=2",
    "container": "mp4",
    "allowed_resolutions": [
      { "label": "4K", "width": 4096, "height": 4096 },
      { "label": "6K", "width": 6144, "height": 6144 },
      { "label": "8K", "width": 8192, "height": 8192 }
    ],
    "allowed_framerates": [30, 60],
    "high_res_high_fps_vbv": {
      "trigger_resolution": "8K",
      "trigger_framerate": 60,
      "vbv_maxrate": 200000,
      "vbv_bufsize": 200000
    }
  },

  "audio": {
    "preferred_format": "5.1",
    "accepted_formats": ["5.1", "stereo"],
    "sample_rate_khz": 44.1,
    "ambisonics_supported": false,
    "stems_required": true,
    "mux_option_available": true
  },

  "delivery": {
    "folder_name_template": "{FilmTitle}_SUPER{Year}",
    "max_file_size_gb": 100
  }
}
```

### What each field controls

| Field | Effect on the tool |
|------|--------|
| `festival_name`, `festival_short`, `version` | Header branding, delivery folder name, report |
| `contact_email`, `website` | Onboarding screen + delivery report footer |
| `festival_icon` (optional) | Base64 data URL of your festival's logo. Renders as a 32×32 icon in the app header next to the festival name. See "Adding your festival icon" below for the easy way to generate it. |
| `submission_deadline` | Color-coded countdown badge in the header (green > 7 days, yellow < 7, orange < 1, red past) |
| `audio_target_lufs` | Target for the LUFS analysis verdict (within ±2 LU = OK) |
| `video.codec` | Currently must be `libx265` (HEVC required by playback systems) |
| `video.crf` | The CRF passed to FFmpeg. **Lower = higher quality, larger file.** 18 is visually lossless. |
| `video.preset` | FFmpeg preset. `slow` is recommended (best quality/size tradeoff). Faster = larger files. |
| `video.x265_params` | Power-user x265 tuning string. The default is calibrated for fulldome content. |
| `video.allowed_resolutions[]` | UI shows ONLY these as buttons. Source files at other resolutions are hard-rejected. |
| `video.allowed_framerates[]` | UI accepts ONLY these. Other rates are hard-rejected unless they're drop-frame (29.97/59.94), which conform with a soft warning. |
| `video.high_res_high_fps_vbv` | Optional: adds VBV bitrate cap for `{trigger_resolution} @ {trigger_framerate}`. Useful to keep 8K60 files bounded. |
| `audio.preferred_format`, `accepted_formats` | UI dropdown options. Ambisonics are explicitly NOT supported (most planetarium systems can't decode them). |
| `audio.sample_rate_khz` | Stems are normalized to this rate during processing |
| `audio.stems_required` | If false, ambient/no-audio is acceptable |
| `audio.mux_option_available` | If false, the "Embed in video" checkbox is hidden |
| `delivery.folder_name_template` | The output folder name. `{FilmTitle}` is the sanitized title, `{Year}` is the version |

---

## Adding your festival icon

The optional `festival_icon` field embeds your festival's logo directly in the config JSON. When an artist loads your config, the icon appears in the app header next to your festival's name — making it visually obvious *which festival they're rendering to* (especially valuable for artists submitting to multiple festivals).

### Recommended source image

- **Size**: 128×128 pixels or 256×256 pixels (square)
- **Format**: PNG with transparency preferred (rounded corners, anti-aliasing)
- **Style**: Flat, high-contrast — small icons in dark UI need to be readable at 32×32
- **File size**: Keep under 20 KB after compression; the tool warns if your config has an icon over 200 KB

### Generating the data URL

Clone the repo and run the helper script:

```bash
node scripts/embed-festival-icon.js path/to/your-festival-logo.png
```

The script prints the line you paste directly into your config JSON. Example output:

```
  "festival_icon": "data:image/png;base64,iVBORw0KGgo...",
```

Just paste it into your festival config (alongside `festival_name`, `festival_short`, etc.) and you're done. No separate icon file to distribute — everything lives in the JSON.

### If you don't have an icon yet

That's fine — the `festival_icon` field is **optional**. The app falls back to a generic 🎬 emoji in a dark square when no icon is provided. Your festival's name and acronym still display correctly. Add the icon later when you have one.

---

## Optional: Screener mode (experimental)

Many festivals receive films in two phases — **screeners** for jury review during selection, then **dome masters** from the artists who get accepted. This tool now supports both.

When your config includes a `screener` block, an artist using the tool sees a **Deliverable** toggle in the app: **🎬 Dome Master** vs **🎞 Screener**. Screener mode produces a low-resolution, fast-encoded MP4 with optional watermarking — appropriate for jury review on a laptop, NOT for dome projection.

### Screener config schema (optional)

```json
{
  "screener": {
    "enabled": true,
    "resolution": { "label": "2K", "width": 2048, "height": 2048 },
    "codec": "libx264",
    "pix_fmt": "yuv420p",
    "crf": 28,
    "preset": "fast",
    "profile": "high",
    "audio_codec": "aac",
    "audio_bitrate": "192k",
    "audio_channels": 2,
    "max_source_label": "4K"
  }
}
```

| Field | Effect |
|---|---|
| `enabled` | Set to `false` to hide screener mode for your festival |
| `resolution` | Output dimensions for the screener (2K square is standard for fulldome) |
| `codec` | H.264 strongly recommended — universally playable on jury laptops |
| `crf` | 28 is a sensible default; lower = higher quality + larger file |
| `preset` | `fast` encodes quickly with acceptable quality. `medium` for slightly smaller files. |
| `audio_*` | Screeners always downmix to stereo AAC |
| `max_source_label` | Optional hint — when source ≤ this bracket, screener mode is recommended |

### Watermarking

When in screener mode, artists can apply a watermark at 30% opacity:
- **Text**: customizable, e.g. "SCREENER · NOT FOR DISTRIBUTION"
- **Image**: a PNG the artist supplies (their studio logo, etc.)
- **Position**: 5 choices (center, 4 corners)
- **Movement**: optional toggle that rotates the watermark between corners every 15 seconds (anti-camcorder measure)

### Output naming

Screeners get a `_SCREENER` suffix in both the folder and file name:

```
Beyond_the_Dome_DFW2027_SCREENER/
├── Beyond_the_Dome_DFW2027_SCREENER.mp4
└── screener_report.txt
```

The `screener_report.txt` is prominently labeled "NOT FOR DOME PROJECTION" so there's no chance of confusing it with a dome master submission.

---

## Resolution governance — the tool never upscales

A critical invariant: the tool will **NEVER** allow upscaling. If an artist drops in a 2K source, they cannot output it "at 8K." This prevents fake dome masters where the file looks high-resolution but is actually low-res image data scaled up.

How it works:

| Source resolution | Festival has [4K, 6K, 8K] | What the artist sees |
|---|---|---|
| 2K (≤ 2048) | none allowed | Buttons all greyed out; if screener mode enabled, prompted to use it instead |
| 4K (≤ 4096) | 4K only | 6K and 8K buttons greyed out with explanation |
| 5K (between brackets) | 4K only | Same — round down, never up |
| 6K (≤ 6144) | 4K + 6K | 8K greyed out |
| 8K (≤ 8192) | 4K + 6K + 8K | All three available |

For non-square sources, both width AND height must fit the target resolution. The tool checks both dimensions.

---

## Recommended encoding spec (don't change unless you know why)

These are the validated baseline values — they're what Dome Fest West uses in production and have been proven on multiple planetarium playback systems (SkySkan and others). New festivals adopting the tool should start with these:

- **Codec**: H.265 / HEVC via `libx265`
- **Bit depth**: 10-bit (`yuv420p10le`)
- **CRF**: 18 (visually lossless, ~25-150 Mbps depending on content)
- **Preset**: `slow`
- **Container**: `.mp4`
- **Frame rates**: 30fps OR 60fps exact only
- **Audio target**: -23 LUFS integrated, ≤-1 dBTP true peak
- **Audio sample rate**: 44.1 kHz
- **Audio format**: 5.1 surround preferred, stereo accepted

**Why no 24fps / 25fps / 29.97fps?** Most planetarium playback systems sync to dome rotation, projector shutter, and DCP-style frame-accurate timing. Drop-frame and PAL rates cause sync drift that's visible on the dome. 30 and 60 are the only rates that work reliably across the major fulldome playback systems.

**Why CRF 18 specifically?** Below 18 produces files so large they overwhelm submission portals (>200GB for 8K60 features). Above 20 starts showing banding on smooth gradients — devastating on a 15m+ dome surface where every pixel is upscaled 1000×.

---

## Verifying received deliveries (Festival Verify Mode)

Once filmmakers start uploading their delivery folders to you, you'll want to confirm each one transferred intact and matches what was originally encoded. The tool has a built-in **Festival Verify Mode** for exactly this — hidden from filmmakers so they don't enable it accidentally.

**To enable it:**

1. Open the **View** menu
2. **View → Festival Tools → Verify Delivery Mode** (toggle it on)

The whole UI switches to verify mode (a `🏛 Verify Mode` chip appears in the header). Drag in any delivery folder you've received and the tool:

- Reads the `delivery_report.txt` inside the folder
- Re-hashes every video and audio file → compares MD5s to the report
- Re-probes the video → confirms codec, resolution, frame rate, and bit depth all match what was originally encoded
- Confirms all audio stems named in the report are present

You get a pass / warn / fail verdict per check, plus a saveable **verification report** to file with each accepted submission. Click the chip (or the **View → Festival Tools → Verify Delivery Mode** menu item again) to turn the mode off and return to the encode interface.

This mode is intentionally undocumented in the README and filmmaker-facing UI. Mention it to your coordinator team, not to artists.

---

## Distribution checklist

To run your festival on this tool:

1. **Fork or download the installer artifacts** from [GitHub Releases](https://github.com/domefestwest/delivery-tool/releases/latest). Three files per release: `.dmg` for Mac, `.exe` for Windows, `.AppImage` for Linux.

2. **Write your config JSON** following the schema above. Validate it with `node -e "JSON.parse(require('fs').readFileSync('your-config.json', 'utf8'))"` — if it errors, fix it.

3. **Host both** somewhere artists can download — your festival website, Google Drive, Dropbox — whatever's easiest.

4. **Tell artists in your call-for-submissions** to:
   - Install the tool (link to your hosted installer)
   - Open the tool, click "Load festival config", pick your JSON
   - Encode and submit the resulting delivery folder (or .zip)

5. (Optional) **Brand your config**: you can override `festival_name`, `festival_short`, `version`, `contact_email`, `website` and the deadline. The tool re-themes the header.

---

## What's NOT customizable yet

Festival configs control encoding rules. They do **not** currently let you:

- Change the UI color scheme (always uses DFW orange — a stylesheet override system is a possible future feature)
- Add per-festival branding images/logos in the header
- Set a custom `contact_phone` / `submission_portal_url` to appear in the report
- Define custom validation rules beyond resolution/framerate/audio
- Require additional metadata (director name, runtime declaration, etc.) in the delivery report

These are tracked in the issue queue at [github.com/domefestwest/delivery-tool/issues](https://github.com/domefestwest/delivery-tool/issues). If you're adopting this for your festival and need any of them, open an issue.

---

## License + attribution

The tool is **MIT licensed** — adopt freely, fork freely. No royalty, no attribution required.

If you do adopt it, an optional acknowledgment in your festival's About / Submissions page is appreciated:

> Delivery encoding by the open-source [Dome Festival Delivery Tool](https://github.com/domefestwest/delivery-tool)

---

## Help / collaboration

If you're running a festival considering adoption, please reach out:

**Ryan@domefestwest.com** — happy to help debug your config, validate your encoding spec, or discuss missing features for your use case.

If you build something on top of this (custom builds for your fest, additional validation rules, etc.) and want to share it back, PRs welcome.
