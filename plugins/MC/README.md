# Music Controls

Control Spotify, YouTube Music and SoundCloud from a player above the YouBar. Spotify works on Android and iOS; YouTube Music and SoundCloud need the Music Controls app on Android.

- **Spotify** (Android and iOS): uses the Spotify account linked in Discord > Connections. Search, queue, shuffle and repeat. No app needed.
- **YouTube Music and SoundCloud** (Android only): install the Music Controls app (APK) from [Music-Controls](https://github.com/dariussbezy/Music-Controls) and give it notification access. The player then shows the song, artist and cover, and can seek. Shuffle and repeat work on YouTube Music; SoundCloud does not share them. The APK is not for iPhone.
- **Listening status** (optional, Android): shows Listening to YouTube Music or SoundCloud on your profile with the song, artist, cover and time.

The player docks above the YouBar with compact and expanded modes, animated waves and swipe to hide.

**Transparent** (Settings, Player, on by default): the card turns into a see-through player that shows the chat behind it, with a thin light edge, a soft top highlight and round translucent buttons. Pick the **Transparency** level: Low, Medium (default) or High (most see-through); the player text stays readable at every level. The card sits flush on the YouBar, without a bottom border or rounded corners, and works with the Transparent YOUBAR plugin to look like one surface. The settings previews show the look over a coloured backdrop. Turn the switch off for the classic solid card. The look lives in `js/transparent.ts`.
