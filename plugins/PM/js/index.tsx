import * as React from "react";
import * as RN from "react-native";
import {
  pList,
  pEmitter,
  isPluginEnabled,
  isPluginStarted,
  isPluginInternal,
  getInternalPluginMeta,
  isPluginPendingReload,
} from "@valenced/plugins/_";
import { formatVersion } from "@valenced/plugins/utils";
import { instead } from "@valenced/patcher";
import {
  summarize,
  singleDifference,
  compareDelay,
  type Metrics,
} from "./metrics";
const ID = "dariuss.performance-monitor",
  INTERVAL = 100,
  WINDOW = 600;
type Baseline = { metrics: Metrics; plugins: string[]; at: number };
type Result = { on: Metrics; off: Metrics; at: number; version: string };
type Data = {
  baseline: Baseline | null;
  results: Record<string, Result>;
  target: string | null;
};
let results: Record<string, Result> = {},
  target: string | null = null;
let baseline: Baseline | null = null,
  save: (data: Data) => Promise<unknown> = async () => {};
let samples: { at: number; delay: number }[] = [],
  next = 0,
  lastState: string | null = null,
  started = 0;
const starts = new Map<string, number>();
const subscribers = new Set<() => void>();
const clock = () => globalThis.performance?.now?.() ?? Date.now();
function installed() {
  return [...pList.values()].filter(
    (p) => p.manifest.id !== ID && !isPluginInternal(getInternalPluginMeta(p)),
  );
}
function activeIds() {
  return installed()
    .filter(isPluginStarted)
    .map((p) => p.manifest.id)
    .sort();
}
function resetWindow() {
  samples = [];
  next = clock() + INTERVAL;
  started = clock();
}
function tick() {
  const now = clock();
  if (lastState !== "active") {
    next = now + INTERVAL;
    return;
  }
  samples.push({ at: now, delay: Math.max(0, now - next) });
  while (
    samples.length &&
    (samples[0].at < now - 60000 || samples.length > WINDOW)
  )
    samples.shift();
  next = now + INTERVAL;
}
function notify() {
  for (const fn of subscribers) fn();
}
function persist(patch: Partial<Data>) {
  const value = { baseline, results, target, ...patch };
  return save(value).then(() => {
    baseline = value.baseline;
    results = value.results;
    target = value.target;
    notify();
  });
}
const ms = (n: number) => n.toFixed(1) + " ms";
function Screen() {
  const [, render] = React.useState(0),
    [error, setError] = React.useState("");
  React.useEffect(() => {
    const fn = () => render((n) => n + 1);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);
  const dark = RN.useColorScheme() !== "light";
  const colors = dark
    ? { bg: "#1E1F22", card: "#2B2D31", text: "#FFFFFF", sub: "#B5BAC1" }
    : { bg: "#FFFFFF", card: "#F2F3F5", text: "#060607", sub: "#5C5E66" };
  const metrics = summarize(samples.map((s) => s.delay)),
    ready = clock() - started >= 30000 && samples.length >= 100;
  const ids = activeIds(),
    changed = baseline ? singleDifference(baseline.plugins, ids) : undefined;
  const changedEnabled = changed ? ids.includes(changed) : false;
  const reload = [...pList.values()].some(isPluginPendingReload);
  const contribution =
    baseline && changed && ready && !reload
      ? changedEnabled
        ? metrics.p95 - baseline.metrics.p95
        : baseline.metrics.p95 - metrics.p95
      : null;
  const comparison =
    baseline &&
    changed &&
    contribution !== null &&
    (!target || target === changed)
      ? {
          on: changedEnabled ? metrics : baseline.metrics,
          off: changedEnabled ? baseline.metrics : metrics,
          at: Date.now(),
          version: formatVersion(
            installed().find((p) => p.manifest.id === changed)!.manifest
              .version,
          ),
        }
      : null;
  const text = (label: string, sub = false) => (
    <RN.Text
      style={{
        color: sub ? colors.sub : colors.text,
        fontSize: sub ? 13 : 15,
        lineHeight: 20,
      }}
    >
      {label}
    </RN.Text>
  );
  const card = (key: string, children: React.ReactNode) => (
    <RN.View
      key={key}
      style={{
        backgroundColor: colors.card,
        padding: 14,
        borderRadius: 12,
        marginBottom: 12,
      }}
    >
      {children}
    </RN.View>
  );
  const button = (label: string, fn: () => void, disabled = false) => (
    <RN.Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={fn}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: disabled ? colors.card : "#5865F2",
        marginBottom: 10,
      }}
    >
      <RN.Text
        style={{
          color: disabled ? colors.sub : "#FFFFFF",
          textAlign: "center",
          fontWeight: "600",
        }}
      >
        {label}
      </RN.Text>
    </RN.Pressable>
  );
  return (
    <RN.ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
    >
      <RN.Text
        style={{
          fontSize: 22,
          fontWeight: "700",
          color: colors.text,
          marginBottom: 8,
        }}
      >
        Plugin Monitor
      </RN.Text>
      {text(
        "Test one plugin at a time. Saved results show how JavaScript delay changed with that plugin enabled versus disabled.",
        true,
      )}
      <RN.View style={{ height: 16 }} />
      {card(
        "global",
        <>
          {text("Current foreground window")}
          {text(`${samples.length} samples · last 60 seconds`, true)}
          {text(`Typical upper delay (p95): ${ms(metrics.p95)}`)}
          {text(`Largest delay: ${ms(metrics.max)}`)}
          {text(
            `Mean delay: ${ms(metrics.mean)} · delayed samples ≥50 ms: ${metrics.stalls}`,
          )}
          {text(
            "Timer delay measures JavaScript responsiveness, not native frame rate or CPU usage. Background periods are excluded.",
            true,
          )}
        </>,
      )}
      {button(
        reload
          ? "Restart Discord before saving a baseline"
          : ready
            ? "Save current baseline"
            : "Collect at least 30 seconds to save a baseline",
        () => {
          const data = { metrics, plugins: ids, at: Date.now() };
          persist({ baseline: data, target: null }).then(
            () => {
              baseline = data;
              setError("");
              notify();
            },
            () => setError("Could not save the baseline."),
          );
        },
        !ready || reload,
      )}
      {button("Restart measurement window", () => {
        resetWindow();
        notify();
      })}
      {baseline
        ? card(
            "comparison",
            <>
              {text("Baseline comparison")}
              {text(new Date(baseline.at).toLocaleString(), true)}
              {text(`Baseline p95: ${ms(baseline.metrics.p95)}`)}
              {text(
                reload
                  ? "Restart Discord before comparing pending plugin changes."
                  : !ready
                    ? "Collect at least 30 seconds after the change."
                    : !changed
                      ? "Change exactly one enabled plugin before comparing."
                      : `Changed plugin: ${installed().find((p) => p.manifest.id === changed)?.manifest.name || changed}`,
              )}
              {text(
                "Repeat the same actions before and after manually disabling one plugin. Restart Discord if required, then wait for a full window. Network, screen changes and background work also affect the result. Repeat to confirm.",
                true,
              )}
            </>,
          )
        : null}
      {comparison && changed
        ? button(
            "Save result for " +
              (installed().find((p) => p.manifest.id === changed)?.manifest
                .name || changed),
            () => {
              persist({ results: { ...results, [changed]: comparison } }).then(
                () => setError(""),
                () => setError("Could not save the result."),
              );
            },
          )
        : null}
      {target
        ? text(
            "Testing: " +
              (installed().find((p) => p.manifest.id === target)?.manifest
                .name || target) +
              ". Disable this plugin manually, restart if required, and repeat the same actions for 30 seconds.",
          )
        : null}
      {error ? text(error) : null}
      <RN.Text
        style={{
          fontSize: 17,
          fontWeight: "600",
          color: colors.text,
          marginBottom: 10,
        }}
      >
        Installed plugins
      </RN.Text>
      {installed()
        .sort((a, b) => {
          const ar = results[a.manifest.id],
            br = results[b.manifest.id];
          const av =
            ar && ar.version === formatVersion(a.manifest.version)
              ? ar.on.p95 - ar.off.p95
              : null;
          const bv =
            br && br.version === formatVersion(b.manifest.version)
              ? br.on.p95 - br.off.p95
              : null;
          if (av !== null && bv !== null) return bv - av;
          if (av !== null) return -1;
          if (bv !== null) return 1;
          return a.manifest.name.localeCompare(b.manifest.name);
        })
        .map((p) =>
          card(
            p.manifest.id,
            <>
              {text(p.manifest.name)}
              {text(
                isPluginStarted(p)
                  ? "Running"
                  : isPluginEnabled(p)
                    ? "Enabled · not running"
                    : "Disabled",
                true,
              )}
              {text(`Recorded JS errors: ${p.errors.length}`)}
              {text(
                starts.has(p.manifest.id)
                  ? `Last observed start: ${ms(starts.get(p.manifest.id)!)} synchronous`
                  : "Startup: not observed",
                true,
              )}
              {(() => {
                const saved = results[p.manifest.id];
                const r =
                  comparison && changed === p.manifest.id
                    ? comparison
                    : saved &&
                        saved.version === formatVersion(p.manifest.version)
                      ? saved
                      : null;
                if (!r)
                  return text(
                    saved ? "Not tested for this version" : "Not tested yet",
                    true,
                  );
                const value = compareDelay(r.on, r.off);
                return (
                  <>
                    {text(
                      `${comparison && changed === p.manifest.id ? "Live" : "Saved"} test: ${value.delta >= 0 ? "+" : ""}${ms(value.delta)} JS delay`,
                    )}
                    {text(
                      value.percent === null
                        ? "Percentage unavailable: disabled delay is below 1 ms."
                        : `${value.percent >= 0 ? "+" : ""}${value.percent.toFixed(0)}% in p95 JavaScript delay`,
                    )}
                    {text(
                      `Enabled: ${ms(r.on.p95)} · Disabled: ${ms(r.off.p95)}`,
                      true,
                    )}
                    {text(
                      new Date(r.at).toLocaleString() +
                        " · comparison, not CPU usage",
                      true,
                    )}
                  </>
                );
              })()}
              {button(
                "Test " + p.manifest.name,
                () => {
                  persist({
                    baseline: { metrics, plugins: ids, at: Date.now() },
                    target: p.manifest.id,
                  }).then(
                    () => {
                      resetWindow();
                      setError("");
                      notify();
                    },
                    () => setError("Could not start the test."),
                  );
                },
                !ready || reload || !isPluginStarted(p),
              )}
              {text(
                !isPluginStarted(p)
                  ? "Enable this plugin and restart if required before starting a new test."
                  : !ready
                    ? "Collect 30 seconds with this plugin enabled to start a test."
                    : "Saves the enabled measurement. You then disable only this plugin and repeat the same actions.",
                true,
              )}
            </>,
          ),
        )}
      {text(
        "Startup timing covers only the synchronous lifecycle call, including nested work. Async work and later callbacks are excluded. Errors and startup time alone do not prove poor optimization. This monitor also adds a small amount of work.",
        true,
      )}
      {text("1.0.0-beta", true)}
    </RN.ScrollView>
  );
}
export default plugin<{ jsonStorage: Data }>({
  jsonStorage: {
    load: true,
    default: { baseline: null, results: {}, target: null },
  },
  async start({ cleanup, jsonStorage }) {
    const data = await jsonStorage.get();
    baseline = data.baseline;
    results = data.results || {};
    target = data.target || null;
    save = (value) => jsonStorage.set(value, true);
    resetWindow();
    lastState = RN.AppState.currentState;
    const app = RN.AppState.addEventListener("change", (state) => {
      lastState = state;
      resetWindow();
      notify();
    });
    const observed = new WeakSet<object>(),
      undos: (() => void)[] = [];
    const observe = () => {
      for (const p of installed()) {
        if (!p.lifecycles.start || observed.has(p.lifecycles.start)) continue;
        const undo = instead(
          p.lifecycles as { start: (...args: any[]) => any },
          "start",
          function (args, original) {
            const t = clock();
            try {
              return Reflect.apply(original, this, args);
            } finally {
              starts.set(p.manifest.id, Math.max(0, clock() - t));
            }
          },
        );
        observed.add(p.lifecycles.start!);
        undos.push(undo);
      }
    };
    let profile = activeIds().join("|");
    const update = () => {
      observe();
      const next = activeIds().join("|");
      if (next !== profile) {
        profile = next;
        resetWindow();
      }
      notify();
    };
    observe();
    pEmitter.on("stateUpdate", update);
    pEmitter.on("statusUpdate", update);
    pEmitter.on("register", update);
    const sampleTimer = setInterval(tick, INTERVAL),
      displayTimer = setInterval(notify, 2000);
    cleanup(() => {
      clearInterval(sampleTimer);
      clearInterval(displayTimer);
      app.remove();
      pEmitter.off("stateUpdate", update);
      pEmitter.off("statusUpdate", update);
      pEmitter.off("register", update);
      for (const undo of undos.reverse()) undo();
      samples = [];
      starts.clear();
      subscribers.clear();
      save = async () => {};
    });
  },
  SettingsComponent: Screen,
});
