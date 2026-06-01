# Example Festival Configs

These are reference configuration files for the **Dome Festival Delivery Tool**. Festival organizers can copy any of them as a starting point and edit to match their festival's delivery requirements.

| File | Use case |
|------|----------|
| `minimal_config.json` | Smallest viable config — 4K only, stereo audio acceptable, lenient defaults. Good starting point for first-time adopters. |
| `strict_8k_only_config.json` | Flagship-tier spec — 8K only, mandatory 5.1 stems, CRF 16 (slightly higher quality than default), veryslow preset, -23 LUFS target. |
| (default shipped) [`dfw_config.json`](../dfw_config.json) | Dome Fest West's working production config — 4K/6K/8K @ 30/60fps, 5.1 preferred but stereo accepted. The proven baseline. |

To use any of these:

1. Copy the JSON file
2. Rename it to `{your-festival-shortcode}_config.json`
3. Edit `festival_name`, `festival_short`, `version`, `contact_email`, `website`, and the delivery `folder_name_template`
4. Adjust encoding rules to match your festival's requirements
5. Distribute to your submitting artists alongside the installer
6. Artists open the app, click **"Load festival config"** in the header, and pick your file

See [FESTIVALS.md](../FESTIVALS.md) for the full schema documentation and field-by-field explanations.
