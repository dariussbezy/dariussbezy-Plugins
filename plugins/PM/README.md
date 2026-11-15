# Performance Monitor

Measures how much time each plugin takes on Discord's JavaScript thread, so you can find the ones that slow Discord down.

It times every patch, JSX hook, Flux event handler and module callback a plugin adds, counting only the plugin's own time. Open its settings to see plugins sorted by total time or by their slowest call, tap one to see where its time goes, and copy a report. Plugins are marked slow when a call drops a frame (16 ms or more) or they keep the thread busy for over 1% of the time.

Keep it enabled and reload Discord so it starts before the other plugins. With Developer Mode on, startup times and plugin names are shown as well. Only JavaScript time is measured, not native rendering or network.
