# dariussbezy's Plugins

dariussbezy's Valenced plugins and themes.

## Install

Add this single URL in **Valenced Settings → Plugins → Advanced → Repository URL**:

```text
https://raw.githubusercontent.com/dariussbezy/dariussbezy-Plugins/main/index.json
```

Choose the plugins you want from the **beta** channel. Existing plugin IDs are preserved. Restart Discord after updates when requested.

For an existing installation, open the plugin's options, set **Repository** to **dariussbezy's Plugins**, select the **beta** channel and enable **Allow updates**. Adding this catalog alone does not switch the repository an installed plugin follows. Switch each plugin before removing its old individual repository entry.

## Plugins and theme

| Name | Description | Source |
| --- | --- | --- |
| [Quick Translate](plugins/QT/README.md) | Translate messages and drafts with Google or DeepL. | [`plugins/QT`](plugins/QT) |
| [Jump to Ping](plugins/JTP/README.md) | Find unread mentions, replies and DMs, then jump straight to the message from the YOUBAR. | [`plugins/JTP`](plugins/JTP) |
| [Show Hidden Channels](plugins/SHC/README.md) | Show hidden channel metadata with lock indicators and an information card. | [`plugins/SHC`](plugins/SHC) |
| [Voice Messages To Text](plugins/VMTT/README.md) | Transcribe voice messages below the audio, with a free server or Groq. | [`plugins/VMTT`](plugins/VMTT) |
| [Adv. Message Logger](plugins/AML/README.md) | Keep a local journal of edited and deleted messages, with in-chat history. | [`plugins/AML`](plugins/AML) |
| [Ghost Ping Logger](plugins/GPL/README.md) | Keep a local journal of deleted mentions and replies, with ghost ping alerts. | [`plugins/GPL`](plugins/GPL) |
| [No Tap Mention](plugins/NTM/README.md) | Disable tapping a message author's name to insert a mention. Stable **1.0.0**, channel **latest**. | [`plugins/NTM`](plugins/NTM) |
| [Spotify Controls](https://github.com/dariussbezy/Spotify-Controls) | Control Spotify above the YOUBAR, search for songs and use a wave progress bar. **1.0.0-beta**. | [Spotify Controls repository](https://github.com/dariussbezy/Spotify-Controls) |
| [Midnight Mobile](themes/MT/README.md) | Midnight for Discord mobile: navy panels, blue accents, Figtree and the moon icon. | [`themes/MT`](themes/MT) |

Jump to Ping is **1.1.0-beta**. Adv. Message Logger and Ghost Ping Logger are **1.0.0-beta**. Quick Translate is **1.0.3-beta**. Midnight Mobile is **1.0.2-beta**. Show Hidden Channels and Voice Messages To Text are **1.0.1-beta**. No Tap Mention is **1.0.0** on the stable **latest** channel.

Spotify Controls is **1.0.0-beta** on **beta**, distributed here as the same approved installable ZIP from its individual repository.

AML and GPL work independently and cooperate when both are enabled. Their beta version numbers have been reset to **1.0.0-beta** with the latest fixes included. If you already installed a higher test version, select **1.0.0-beta** manually and then resume following **beta**; an update check does not offer downgrades.

Midnight's colors, Figtree font and moon icon are selected separately under **Valenced Settings → Themes**. Font and icon changes require a restart.

## Credits

Plugin adaptations by dariuss with Codex. Midnight was originally created by [refact0r](https://github.com/refact0r/midnight-discord), with Figtree by Erik Kennedy and the Font Awesome moon icon. Required third-party notices are included with Midnight's assets.

The individual repositories host test builds. [Liquid Glass YOUBAR](https://github.com/dariussbezy/Liquid-Glass-YOUBAR) is developed and tested in its own repository.
