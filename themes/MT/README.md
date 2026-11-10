# Midnight Mobile

The Midnight desktop theme, adapted for **Valenced on Discord mobile**. The original desktop CSS remains available in this repository.

## Install

Add this URL in **Valenced Settings → Plugins → Advanced → Repository URL**:

```text
https://raw.githubusercontent.com/dariussbezy/dariussbezy-Plugins/main/index.json
```

Install **Midnight Mobile** from the **beta** channel, then restart Discord. Keep Valenced's community repository enabled so the Themes dependencies can be installed.

In **Valenced Settings → Themes**:

1. Under **Color themes**, choose **Midnight → Midnight (Auto)**.
2. Under **Fonts**, choose **Midnight Figtree** for the sans-serif font.
3. The navigation moon is included when Midnight is active with default Discord icons. Optionally choose **Midnight Moon** under **Icons** for the additional Home/Clyde asset replacements.
4. Restart Discord after changing fonts or icons.

You can also install [the beta ZIP](../../pool/dariuss.midnight-theme@1.0.0-beta.zip) using **Install from file**.

## Features

- The original blue accents, navy palette, text colors and status colors. Native controls keep opaque base colors; Valenced handles translucency on supported gradient surfaces.
- The original wallpaper, bundled locally and softened with a subtle background blur.
- Dark and light palettes following Discord's appearance, including automatic appearance when enabled in Discord.
- Figtree with normal, medium, semibold, bold, extra bold and italic variants. Code blocks keep Discord's monospace font.
- The original Font Awesome moon appears in the Home/DMs navigation button. Other chat icons remain unchanged. Custom icon packs are respected; the optional Midnight Moon pack also replaces Home/Clyde assets.
- Optional **Rounded surfaces** gives the channel list, channel header and message composer proportionate corner radii while preserving their layout. It applies only while Midnight is the selected color theme. Restart after changing this option.
- Native Discord settings controls. No recurring network requests, timers or screenshot-based blur.

Mobile uses React Native, so desktop CSS cannot be installed directly. Window controls, mouse hover effects and the desktop multi-column arrangement do not transfer to a phone. Translucency uses Valenced's background API. Valenced applies the blur to the wallpaper layer, keeping text and controls sharp. Surface styling targets Discord 352.6 and skips components it cannot identify.

To return to Discord's appearance, choose the default colors, font and icons in Themes, or disable Midnight Mobile and restart.

## Credits

- [refact0r](https://github.com/refact0r/midnight-discord): original Midnight theme. This adaptation uses the customized `midnight-auto-v2_theme.css` in this repository.
- [Figtree](https://github.com/google/fonts/tree/main/ofl/figtree), by Erik Kennedy: bundled under the SIL Open Font License. The required notice is included with the font files.
- [Font Awesome](https://fontawesome.com/license/free): original moon icon, converted to PNG for mobile. Icon attribution and license are included in the asset notices.
- Dariuss: mobile adaptation.

Mobile sources are in [`js`](js); installation files are in the repository [pool](../../pool). Version: **1.0.0-beta**. Android device testing and iOS device testing are still pending; local tests cover registration, palette values, React rendering, Yoga layout geometry, icon isolation and packaging.

After updating, reselect **Midnight (Auto)** and restart Discord completely so cached native colors are refreshed. If you use the optional **Midnight Moon** icon pack, reselect it once to refresh its asset mappings.
