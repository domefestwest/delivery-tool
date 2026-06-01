# Installation Guide — for Artists

This is the install guide for filmmakers submitting to **Dome Fest West**.
If you're a developer working on the tool itself, see the main [README.md](./README.md) instead.

---

## Download

Go to the **[Releases page](https://github.com/domefestwest/delivery-tool/releases/latest)** and download the file matching your operating system:

| Your OS | Download |
|---------|----------|
| **macOS** (Apple Silicon — M1/M2/M3/M4) | `Dome Fest West Delivery Tool-x.x.x-arm64.dmg` |
| **macOS** (Intel) | `Dome Fest West Delivery Tool-x.x.x-x64.dmg` |
| **Windows 10/11** | `Dome Fest West Delivery Tool-Setup-x.x.x.exe` |
| **Linux** (x86_64) | `Dome Fest West Delivery Tool-x.x.x.AppImage` |

Not sure which Mac you have? Apple menu → **About This Mac**. If "Chip" starts with "Apple", you want the **arm64** download. If "Processor" says "Intel", you want **x64**.

---

## First-time setup

Because we don't pay Apple's or Microsoft's developer-signing fees while this tool is still in beta, your operating system will show a security warning the first time you launch it. This is **normal and expected**. The tool is fully open-source — every line of code is on GitHub. Here's how to bypass the warning on each platform.

You only need to do this **once** per install.

### macOS

When you double-click the `.dmg` you'll be able to drag the app into your Applications folder normally. The warning appears when you first try to launch it.

**Recommended bypass:**

1. Open **Applications** in Finder
2. **Right-click** (or Ctrl-click) the **Dome Fest West Delivery Tool** app
3. Choose **Open** from the menu
4. macOS shows a dialog: *"macOS cannot verify the developer..."* — click **Open** anyway
5. The app launches. You won't see this warning again.

**If that doesn't work** (newer macOS may block right-click bypass):

1. Try to open the app normally (it'll get blocked)
2. Open **System Settings** → **Privacy & Security**
3. Scroll down to **Security**
4. You'll see: *"Dome Fest West Delivery Tool was blocked..."* — click **Open Anyway**
5. Authenticate with your password / Touch ID
6. The app launches.

### Windows

Run the `.exe` installer. Windows SmartScreen may block it with a blue dialog.

1. The dialog says **"Windows protected your PC"**
2. Click **More info** (small link below the message)
3. The dialog expands to show **Run anyway** — click it
4. The installer runs normally
5. Follow the prompts (default settings are fine)

After install:
- **Start Menu shortcut**: "DFW Delivery Tool"
- **Desktop shortcut** (if you enabled it during install)

### Linux

The AppImage is a single executable file — no installer.

1. Open a terminal in the folder where you downloaded the `.AppImage`
2. Make it executable:
   ```bash
   chmod +x "Dome Fest West Delivery Tool-x.x.x.AppImage"
   ```
3. Double-click it in your file manager, OR run it from the terminal:
   ```bash
   ./Dome\ Fest\ West\ Delivery\ Tool-x.x.x.AppImage
   ```

Some distros (Ubuntu 22.04+, Fedora 38+) require **FUSE** for AppImage to work:
```bash
sudo apt install libfuse2     # Ubuntu/Debian
sudo dnf install fuse-libs    # Fedora
```

---

## Updating

When a new version is released, just download the new installer and run it. Your saved settings (artist name, preferred output folder, recent encodes) are preserved.

On Windows: install the new `.exe` over the existing one — it'll replace it.

On macOS: drag the new `.app` from the `.dmg` into Applications, replacing the old one when prompted.

On Linux: replace the `.AppImage` file with the new version.

---

## Uninstalling

### macOS
Drag **Dome Fest West Delivery Tool.app** from **Applications** to the Trash.

Settings stored in `~/Library/Application Support/Dome Fest West Delivery Tool/` — delete that folder if you want a fully clean removal.

### Windows
**Settings → Apps → Installed apps** → find **Dome Fest West Delivery Tool** → click **⋯** → **Uninstall**.

Settings stored in `%APPDATA%\Dome Fest West Delivery Tool\` — by default the uninstaller preserves these for reinstall. Delete that folder for a fully clean removal.

### Linux
Just delete the `.AppImage` file.

Settings stored in `~/.config/Dome Fest West Delivery Tool/` — delete that folder for a fully clean removal.

---

## Trouble?

- App won't launch at all → check that your OS meets minimum requirements: **macOS 10.15+**, **Windows 10+**, or **Linux with glibc 2.31+** (Ubuntu 20.04+ / Fedora 33+ / equivalent)
- "FFmpeg not detected" on launch → file an issue on [GitHub Issues](https://github.com/domefestwest/delivery-tool/issues) with a screenshot of the onboarding screen
- Encoding fails partway → the app's error message includes the FFmpeg output; copy that into an issue or email it to **Ryan@domefestwest.com**
- Anything else → **Ryan@domefestwest.com**
