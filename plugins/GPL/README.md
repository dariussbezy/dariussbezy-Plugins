# Ghost Ping Logger

Finds mentions and replies that were deleted, or edited so they no longer ping you, and alerts you about them.

Requires **Adv. Message Logger** (2.x). Ghost Ping Logger keeps no journal of its own: it reads the one Adv. Message Logger keeps, so ignore lists, retention, cache size and the bot filter set there also apply here.

## Features

- Detection for direct, role and everyone/here mentions and replies, each switchable.
- A native alert with a jump action and a searchable ghost ping history with saved filters.
- Optional in-chat retention of deleted ghost pings and colored usernames.

## Development

Run `bun install --frozen-lockfile`, then `bun run lint`, `bun run lint:types` and `bun run build`.
