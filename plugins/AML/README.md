# Adv. Message Logger

Keeps a local, searchable journal of message edits and deletions observed by this Discord client, and shows them in chat.

It is also a library: plugins that declare it as a dependency (such as Ghost Ping Logger) receive its journal, alerts, history view and chat-row hooks as `api.aml`.

## Features

- Separate deleted and edited journals with search, date filters and saved filters.
- Previous message versions and deleted messages shown in chat, with configurable colors and time labels.
- Long-press and profile menu entries to view history or ignore a user, DM, channel or server.
- Direct message alerts, bulk delete logging, All or Loaded-only capture and a configurable recent cache.

Retaining a deleted message requires the original in Discord's cache. Logs stay on this device.

## Development

Run `bun install --frozen-lockfile`, then `bun run lint`, `bun run lint:types` and `bun run build`.
