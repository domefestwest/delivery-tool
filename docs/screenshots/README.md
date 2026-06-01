# Screenshots for README and Releases

This directory holds the visual assets referenced from the project's
documentation and release notes.

## Recommended captures

For the README and any festival's call-for-submissions page, the
highest-value screenshots are (in priority order):

### 1. `01-main-window.png` — the primary product shot
Take when a film is fully loaded and ready to encode. Required state:
  - A real fulldome film loaded (PNG sequence or video)
  - Preview thumbnail showing in the left column
  - Source info chips populated (frame count, bit depth, resolution)
  - SettingsPanel filled in (film title, artist, output folder)
  - Pre-flight bar showing "✓ Disk · Est ~XGB · 🎬 Test 5s"
  - "▶ Encode and Package" button enabled
  - Window size: 1100×820 (the app's default)

This is the single image that conveys "drop your film, hit encode" in
one frame.

### 2. `02-encoding-progress.png` — the tool doing work
Take during an active encode. Required state:
  - Progress bar partway through
  - Frame counter visible ("Frame 1,847 / 5,400 · 34%")
  - Live encoding fps visible
  - Speed multiplier (1.5×, 21×, etc.)
  - ETA visible ("⏱ 3m 12s remaining")
  - Live output size visible
  - Either ⚡ GPU or 🖥 CPU chip

### 3. `03-delivery-complete.png` — the payoff
Take after a successful encode. Required state:
  - Green "✓ Delivery package complete!" alert
  - Output verification panel (green checkmark)
  - Loudness panel (LUFS reading)
  - Delivery folder location shown
  - "📁 Open Folder" button visible
  - The collapsible delivery_report.txt preview expanded

### 4. `04-onboarding.png` — for the README's "first launch" mention
Capture the FFmpeg-missing onboarding screen, even if just as a
synthetic test (you can remove ffmpeg/mac/ffmpeg temporarily).

### 5. `05-festival-deadline-badge.png` — close-up of the deadline chip
Crop just the top header showing the orange/yellow/red deadline countdown.

### 6. `06-recent-encodes.png` — the productivity feature
Click "📁 Open ▾" in the FILM section header so the popover is visible
showing PROJECT actions + RECENT ENCODES list.

## Capture tips

- Use a real fulldome film, not the synthetic test patterns — looks more
  professional in screenshots
- Window size 1100×820 is the app default and matches what most users see
- On macOS: ⌘⇧4 + Spacebar then click the app window to capture without
  decorations, or ⌘⇧4 + drag for a specific region
- Compress with TinyPNG or ImageOptim before committing — small repo
  matters for clone times

## Referencing in docs

In README.md, reference as:

    ![Main window](./docs/screenshots/01-main-window.png)

Width hint via HTML if needed:

    <img src="./docs/screenshots/01-main-window.png" width="800" alt="Main window">
