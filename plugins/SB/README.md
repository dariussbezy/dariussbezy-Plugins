# Show Blocked

Shows messages from users you blocked or ignored as normal messages, as if they were not blocked. No collapsed "N blocked messages" group, no "Show message" tap, no dimming.

## What it does
- Server channels and threads: messages from blocked and ignored users show normally.
- Group chats: same, controlled by **Also in group chats** (on by default).
- 1:1 DMs: same, controlled by **Also in direct messages** (on by default). Blocked and ignored users still cannot DM you; this only changes how old messages look.

## Settings
- **Show blocked users' messages** (on)
- **Show ignored users' messages** (on)
- **Also in group chats** (on)
- **Also in direct messages** (on)
- **Allow pings from blocked users** (on): messages that mention you (or @everyone) stay visible and can ping you. Off keeps Discord's normal behaviour for those messages.
- **Keep these hidden**: turn on any blocked or ignored user (or add one by ID) to keep their messages looking blocked, as in Discord.

## Notes
- Only affects how messages are displayed. It does not unblock anyone, change your relationships or notifications, or send anything.
- Messages already loaded keep their old look; switch channel or restart Discord to reload them.
- How it works: it makes `RelationshipStore.isBlockedForMessage` and `isIgnoredForMessage` answer "no" for messages (per the settings above), and restores them when the plugin stops.
