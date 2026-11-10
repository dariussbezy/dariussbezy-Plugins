# Liquid Glass YOUBAR

A glass-inspired finish for Discord's bottom dock, built for Valenced on Android.

**Version: 1.0.0-beta** · **Recovery build 3** · Targets Discord 352.6 and Valenced Plugin API 1.

## Installation

In Valenced, open **Plugins → Advanced → Repository URL**, add this repository, then install **Liquid Glass YOUBAR** from the **beta** channel:

```text
https://raw.githubusercontent.com/dariussbezy/dariussbezy-Plugins/main/index.json
```

Restart Discord after installing or enabling the plugin. Open its settings to adjust the finish.

If an earlier build crashes at startup, remove Liquid Glass YOUBAR in Recovery, fully close Discord, then install [Recovery build 3](../../pool/dariuss.liquid-glass-youbar@1.0.0-beta.zip). Its description says **Recovery build 3** so you can verify which package is installed.

## Features

- Translucent rounded glass surface with subtle edge reflections.
- Native Android backdrop blur when Discord exposes a supported renderer and a separate backdrop.
- **Subtle**, **Balanced** and **Frosted** finish presets.
- Independent switches for the glass appearance, backdrop blur and highlights.
- Light and dark theme support, with an appearance preview in settings.
- Matching animated on/off switches, with the same shape and dimensions as the other plugins.
- A status label showing whether backdrop blur or the translucent finish is active.
- Keeps Discord's original buttons, badges, gestures, positioning and navigation.
- Respects **Reduce Transparency** where the system exposes it.
- Restores Discord's original background when the glass appearance is disabled.
- Restores the original dock automatically if a glass component cannot be rendered.

## About the effect

The finish combines native blur, translucent tint and static light reflections. Its native rendering and appearance still need confirmation on a real Android device; local checks cover the integration and lifecycle.

On Android 12 and later, blur uses Discord's built-in native blur-target component to sample a separate view. The plugin checks that this view does not contain the dock itself. If that check fails, native blur is unavailable, or older hardware cannot use the supported blur path, the dock keeps its translucent glass finish. Software blur is disabled to avoid the heavier fallback path.

The plugin styles the current **YouBar** dock. Other navigation layouts remain unchanged. The sources use React Native and contain no custom Android binaries; iOS behavior is untested.

## Privacy and performance

No network requests, analytics, screenshots or polling. Settings stay in Valenced's local plugin storage. The effect adds a small number of views to the dock; native blur can still add rendering work. Choose **Subtle** or turn off **Backdrop blur** for a lighter finish.

Sources are in [`js`](./js). The installable package is in the repository [pool](../../pool). The installed ZIP contains only the script and manifest.
