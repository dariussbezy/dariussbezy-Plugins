# Plugin Monitor for Valenced

A small diagnostic plugin with a plain list of installed plugins. Version: **1.0.0-beta**.

## Features

- **JavaScript responsiveness:** average, largest and 95th-percentile timer delay, plus samples delayed by 50 ms or more, in a rolling 60-second foreground window.
- **Per-plugin results:** saved p95 delay differences in milliseconds and percent, enabled/disabled readings and test timestamps. Measured plugins are listed first, ordered by their saved delay difference. Untested plugins are marked explicitly.
- **Installed plugin diagnostics:** running/disabled state, recorded JavaScript errors and the last observed synchronous startup call.
- **Baseline comparison:** save a measurement, change one plugin manually, and compare the delay with that plugin enabled versus disabled.
- **Background exclusion:** entering or leaving the background resets the window so suspended timers do not count as stalls.
- **Bounded sampling:** one timer every 100 ms, at most 600 samples, with screen updates every two seconds. The monitor itself adds some overhead.

## Installation

Add this Repository URL in **Valenced → Plugins → Advanced**:

```text
https://raw.githubusercontent.com/dariussbezy/dariussbezy-Valenced-Plugins-Themes/main/index.json
```

Select **beta**, install **Plugin Monitor**, enable it, and open its settings. The current beta targets Valenced 1.3.0 and Discord 352.6 alpha. On-device behavior still needs verification.

## Comparing a plugin

1. Use Discord in a repeatable way for at least 30 seconds with the plugin enabled. Open Plugin Monitor and tap **Test [plugin name]** on its row. This saves the enabled measurement and remembers which plugin you are testing.
2. Disable only that plugin manually. Restart Discord if Valenced requires it; the saved baseline survives a restart.
3. Repeat the same actions on the same screen, with the same other plugins enabled, for at least 30 seconds.
4. Open Plugin Monitor. Its row shows the enabled and disabled p95 readings, the difference in milliseconds, and the relative change in percent. Tap **Save result for [plugin name]** to keep the result in the list across restarts.

For example, 5 ms enabled versus 2 ms disabled is **+3 ms / +150% in p95 JavaScript delay**. This does **not** mean the plugin consumes 150% CPU or slows all of Discord by 150%. If the disabled reading is below 1 ms, the percentage is omitted to avoid dividing by an unstable near-zero value. A positive difference means the enabled measurement had higher delay; a negative difference means it had lower delay. Results from earlier plugin versions are marked as requiring a new test.

Repeat the experiment to check consistency. Network activity, Discord itself, device load, screen changes and different actions can change the result. The monitor never automatically enables, disables or restarts another plugin.

## Reading the numbers

**This is not a per-plugin CPU or RAM profiler.** Valenced does not expose isolated CPU or memory usage for each JavaScript plugin. Ongoing per-plugin usage is displayed as unavailable. Timer delay is a responsiveness signal, not native frame rate or CPU percentage. Sampling can miss stalls between timer ticks.

Startup timing is recorded only when the monitor observes a plugin's start lifecycle. It includes synchronous nested work, but excludes awaited work and callbacks that run later. **Startup: not observed** is not a zero. Early-starting plugins may already have started before the monitor can observe them.

A comparison is associated with a plugin only when exactly one running plugin differs from the saved baseline. Pending reloads block comparison. Changing the running plugin set resets the measurement window to keep measurements from different configurations separate. This association is not proof of causation, and neither a long startup call nor an error alone proves poor optimization.

## Privacy

No message contents, account tokens or network traffic are collected. Measurements stay in memory. Only manually saved baselines, per-plugin comparison results, timestamps, plugin versions and plugin IDs are stored locally through Valenced. No data is sent to an external service.
