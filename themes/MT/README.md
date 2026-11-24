# Midnight Mobile

Midnight for Discord mobile, as close as the app allows to refact0r's desktop theme: navy surfaces at 60% over the original wallpaper, blue accents, Figtree and the moon logo.

1. Enable **Midnight Mobile** and restart Discord.
2. Choose **Midnight** in **Valenced Settings → Themes → Color themes**.
3. Optional: **Midnight Figtree** under Fonts and **Midnight Moon** under Icons (restart after changing).

Every color Discord mobile uses is set from the desktop theme's own variables (text-0 to text-5, bg-1 to bg-4, hover/active, accents and status colors), including the chat input, headers, action sheets, toasts, badges and voice controls. `scripts/make-palette.cjs` fills `js/palette.json` from `scripts/mobile-tokens.json`, the list of color names read from the Discord app; run it after a Discord update adds new ones.

## Credits

- [refact0r](https://github.com/refact0r/midnight-discord): original Midnight theme.
- [Figtree](https://github.com/google/fonts/tree/main/ofl/figtree) by Erik Kennedy, SIL Open Font License.
- [Font Awesome](https://fontawesome.com/license/free): moon icon.
