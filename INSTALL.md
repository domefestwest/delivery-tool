# Installation Guide — for Artists

This is the install guide for filmmakers submitting to **any fulldome festival** that uses the **Dome Festival Delivery Tool** (originally built for Dome Fest West, now adopted by multiple festivals — your festival should have given you their config file separately).

If you're a developer working on the tool itself, see the main [README.md](./README.md) instead. If you're a festival organizer evaluating the tool for your festival, see [FESTIVALS.md](./FESTIVALS.md).

---

## Download

Go to the **[Releases page](https://github.com/domefestwest/delivery-tool/releases/latest)** and download the file matching your operating system:

| Your OS | Download |
|---------|----------|
| **macOS** (Apple Silicon — M1/M2/M3/M4) | `Dome Festival Delivery Tool-x.x.x-arm64.dmg` |
| **macOS** (Intel) | `Dome Festival Delivery Tool-x.x.x-x64.dmg` |
| **Windows 10/11** | `Dome Festival Delivery Tool-Setup-x.x.x.exe` |
| **Linux** (x86_64) | `Dome Festival Delivery Tool-x.x.x.AppImage` |

Not sure which Mac you have? Apple menu → **About This Mac**. If "Chip" starts with "Apple", you want the **arm64** download. If "Processor" says "Intel", you want **x64**.

---

## First-time setup

Because we don't pay Apple's or Microsoft's developer-signing fees while this tool is still in beta, your operating system will show a security warning the first time you launch it. This is **normal and expected**. The tool is fully open-source — every line of code is on GitHub. Here's how to bypass the warning on each platform.

You only need to do this **once** per install.

### macOS

When you double-click the `.dmg` you'll be able to drag the app into your Applications folder normally. macOS will block the first launch attempt with a security warning. Depending on your macOS version and the message you see, follow ONE of the three options below.

**Option A: "macOS cannot verify the developer" message**

1. Open **Applications** in Finder
2. **Right-click** (or Ctrl-click) the **Dome Festival Delivery Tool** app
3. Choose **Open** from the menu
4. Click **Open** in the dialog that appears
5. The app launches. You won't see this warning again.

**Option B: "is blocked from use" or you don't see the right-click bypass**

1. Try to open the app normally (it'll get blocked)
2. Open **System Settings** → **Privacy & Security**
3. Scroll down to **Security**
4. You'll see: *"Dome Festival Delivery Tool was blocked..."* — click **Open Anyway**
5. Authenticate with your password / Touch ID

**Option C: "is damaged and can't be opened" message**

> This only affects versions **v0.16.3 and older**. Version **v0.16.4 onwards** is ad-hoc signed and no longer hits this error path — you'll get the friendlier "unidentified developer" warning (Option A) instead. If you're seeing the "damaged" message, either download the latest release or follow the steps below.

Despite what the dialog says, the app is NOT actually damaged. Your browser added a "quarantine" flag to the downloaded file, and on older builds the app wasn't signed enough for macOS to show the bypass UI. The fix takes one Terminal command.

1. Open **Terminal** (in Applications → Utilities, or press ⌘+Space and type "Terminal")
2. Copy and paste this command, then press Enter (you'll be prompted for your password):
   ```bash
   sudo xattr -rd com.apple.quarantine "/Applications/Dome Festival Delivery Tool.app"
   ```
3. Now go to **System Settings** → **Privacy & Security**, scroll to **Security**, and click **Open Anyway**

Note: the regular `xattr` command without `sudo` often appears to succeed but is silently blocked by /Applications permissions. Always use `sudo`.

### Windows

Run the `.exe` installer. Windows SmartScreen may block it with a blue dialog.

1. The dialog says **"Windows protected your PC"**
2. Click **More info** (small link below the message)
3. The dialog expands to show **Run anyway** — click it
4. The installer runs normally
5. Follow the prompts (default settings are fine)

After install:
- **Start Menu shortcut**: "Dome Festival Delivery"
- **Desktop shortcut** (if you enabled it during install)

### Linux

The AppImage is a single executable file — no installer.

1. Open a terminal in the folder where you downloaded the `.AppImage`
2. Make it executable:
   ```bash
   chmod +x "Dome Festival Delivery Tool-x.x.x.AppImage"
   ```
3. Double-click it in your file manager, OR run it from the terminal:
   ```bash
   ./Dome-Festival-Delivery-Tool-x.x.x.AppImage
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
Drag **Dome Festival Delivery Tool.app** from **Applications** to the Trash.

Settings stored in `~/Library/Application Support/Dome Festival Delivery Tool/` — delete that folder if you want a fully clean removal.

### Windows
**Settings → Apps → Installed apps** → find **Dome Festival Delivery Tool** → click **⋯** → **Uninstall**.

Settings stored in `%APPDATA%\Dome Festival Delivery Tool\` — by default the uninstaller preserves these for reinstall. Delete that folder for a fully clean removal.

### Linux
Just delete the `.AppImage` file.

Settings stored in `~/.config/Dome Festival Delivery Tool/` — delete that folder for a fully clean removal.

---

## Trouble?

- App won't launch at all → check that your OS meets minimum requirements: **macOS 10.15+**, **Windows 10+**, or **Linux with glibc 2.31+** (Ubuntu 20.04+ / Fedora 33+ / equivalent)
- "FFmpeg not detected" on launch → file an issue on [GitHub Issues](https://github.com/domefestwest/delivery-tool/issues) with a screenshot of the onboarding screen
- Encoding fails partway → the app's error message includes the FFmpeg output; copy that into an issue or email it to **Ryan@domefestwest.com**
- Anything else → **Ryan@domefestwest.com**
