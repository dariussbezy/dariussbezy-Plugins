# Adv. Message Logger

A Valenced beta that keeps a local, searchable journal of message edits and deletions observed by Discord on this device.

## Install

Add the following URL in **Valenced → Plugins → Advanced**, then install **Adv. Message Logger** from **beta**.

```text
https://raw.githubusercontent.com/dariussbezy/dariussbezy-Plugins/main/index.json
```

Version **1.0.1-beta** requires Valenced Plugin API **1**.

## What this beta includes

- Native settings, separate edited and deleted journals, saved search and date filters, and individual entry removal.
- In-chat previous message text and retained deleted rows, with configurable colors and timestamps. Discord message, channel, server and user menus provide access to history or ignore controls.
- Direct message alerts, bulk deletion logging, and All or Loaded-only capture with a configurable recent cache. The journal and recent cache can be saved and cleared separately.
- Optional cooperation with [Ghost Ping Logger](https://github.com/dariussbezy/Ghost-Ping-Logger). Each plugin keeps its own journal and the same event only triggers one alert when both would notify.

Logging uses events received by this Discord client. Retaining a deleted row requires the original message in Discord's cache. Edit history uses plain text in the native message row. Logs stay on this device.

## Development

Run `bun install --frozen-lockfile` and then `npm run publish:local` to build the ZIP and regenerate the index. Run `npm run lint:types` and `npm test` to check the build.
