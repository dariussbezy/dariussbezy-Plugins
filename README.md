# dariussbezy-Plugins

All of dariuss' Valenced plugins and the Midnight mobile theme in one repository, based on the [official Valenced plugin template](https://github.com/Valenced/valenced-plugin-template).

## Install

Add this single URL in **Valenced Settings → Plugins → Advanced → Repository URL**:

```text
https://raw.githubusercontent.com/dariussbezy/dariussbezy-Plugins/main/index.json
```

Choose the plugins you want from the **beta** channel. Existing plugin IDs and versions are preserved. You can remove the old individual repository entries from Valenced after adding this repository; installed plugin settings remain associated with their existing IDs. Restart Discord after updates when requested.

## Plugins and theme

| Name | Description | Source |
| --- | --- | --- |
| [Quick Translate](plugins/QT/README.md) | Translate messages and drafts with Google or DeepL. | [`plugins/QT`](plugins/QT) |
| [Jump to Ping](plugins/JTP/README.md) | Find unread mentions, replies and DMs, then jump straight to the message. | [`plugins/JTP`](plugins/JTP) |
| [Plugin Monitor](plugins/PM/README.md) | Measure JavaScript responsiveness and compare plugin configurations. | [`plugins/PM`](plugins/PM) |
| [Show Hidden Channels](plugins/SHC/README.md) | Show hidden channel metadata with lock indicators and an information card. | [`plugins/SHC`](plugins/SHC) |
| [Voice Messages To Text](plugins/VMTT/README.md) | Transcribe voice messages below the audio, with a free server or Groq. | [`plugins/VMTT`](plugins/VMTT) |
| [Liquid Glass YOUBAR](plugins/LGD/README.md) | A glass finish for the Discord bottom dock. Recovery build 3. | [`plugins/LGD`](plugins/LGD) |
| [Midnight Mobile](themes/MT/README.md) | Midnight for Discord mobile: navy panels, blue accents, Figtree and the moon icon. | [`themes/MT`](themes/MT) |

All current versions are **1.0.0-beta**. Only the beta channel is published.

Midnight's colors, Figtree font and moon icon are selected separately under **Valenced Settings → Themes**. Font and icon changes require a restart.

## Credits

Plugin adaptations by dariuss with Codex. Midnight was originally created by [refact0r](https://github.com/refact0r/midnight-discord), with Figtree by Erik Kennedy and the Font Awesome moon icon. Required third-party notices are included with Midnight's assets.

The previous individual repositories remain available for historical links; ongoing development is consolidated here.
