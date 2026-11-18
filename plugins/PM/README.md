# Performance Monitor

Measures how much time each plugin takes on Discord's JavaScript thread, so you can find the ones that slow Discord down.

It times every patch, JSX hook, Flux event handler and module callback a plugin adds, counting only the plugin's own time. Open its settings to see plugins sorted by total time or by their slowest call, tap one to see where its time goes, and copy a report. Plugins are marked slow when a call drops a frame (16 ms or more) or they keep the thread busy for over 1% of the time.

Keep it enabled and reload Discord so it starts before the other plugins. With Developer Mode on, startup times and plugin names are shown as well. Only JavaScript time is measured, not native rendering or network.

## Finding what causes stalls

- **Stall analysis**: when the JS thread is busy for over 100 ms, the time is split into plugin hooks, Discord's own Flux handling and the rest (React rendering, timers, native events, garbage collection). It names the plugins whose hooks took most of it, and the slowest single call. The split is an estimate.
- **Hooked functions**: time per hooked function and per kind (JSX hooks, patches, Flux handlers), all plugins together, so a pile-up of many plugins on one function is visible.
- **Percentiles and call type**: 95% and 99% of a plugin's calls stay under a given time; hooks are flagged as heavy per call, or cheap but called very often.
- **The monitor's own cost** is estimated, and **light mode** times only one call in ten to lower it (totals become estimates).
- **JS frames** that came late are counted while the settings page is open. Only the JS side is visible: the UI thread, Reanimated and per-gesture timing cannot be seen by a plugin.
- **Saved runs**: save a run with an activity label, and compare two runs, for example with all other plugins off (a baseline) against with them on.
