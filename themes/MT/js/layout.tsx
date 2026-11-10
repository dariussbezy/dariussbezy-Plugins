import * as React from "react";
import { View } from "react-native";
import { Stores } from "@valenced/discord/flux";
import { getModules } from "@valenced/modules/finders";
import { createFilterGenerator, FilterScopes } from "@valenced/modules/finders/filters";
import { afterJSX } from "@valenced/react/jsx-runtime";
import { after } from "@valenced/patcher";
import * as Native from "@valenced/modules/native";

export const ProviderId = "dariuss.midnight-theme";
type Kind = "header" | "composer" | "channels";
const Names: Record<string, Kind> = {
  ChannelHeader: "header",
  ChatInput: "composer",
  ChannelListLayout: "channels",
};
let active = false;
const listeners = new Set<() => void>();
function setActive(value: boolean) {
  if (value === active) return;
  active = value;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const snapshot = () => active;

export function isMidnightSelection(state: any): boolean {
  return state?.colors?.plugin === ProviderId;
}

function componentName(type: any, depth = 0): string | undefined {
  if (!type || depth > 4) return;
  if (typeof type === "function") return type.displayName || type.name;
  if (type.$$typeof === Symbol.for("react.memo")) return componentName(type.type, depth + 1);
  if (type.$$typeof === Symbol.for("react.forward_ref")) return componentName(type.render, depth + 1);
}

export function resolveTargets(namespace: any, names: Set<string>): { type: any; name: string }[] {
  if (!namespace || (typeof namespace !== "object" && typeof namespace !== "function")) return [];
  const seen = new Set();
  const result: { type: any; name: string }[] = [];
  for (const type of [namespace, namespace.default, ...Object.keys(Names).map(name => namespace[name])]) {
    if (!type || seen.has(type)) continue;
    seen.add(type);
    const name = componentName(type);
    if (name && names.has(name)) result.push({ type, name });
  }
  return result;
}

export function frameElement(original: React.ReactElement, Frame: React.ComponentType<any>, kind: Kind) {
  return React.createElement(Frame, { key: original.key, original, kind });
}

function Frame({ original, kind }: { original: React.ReactElement; kind: Kind }) {
  const enabled = React.useSyncExternalStore(subscribe, snapshot, snapshot);
  const store = (Stores as any).ThemeStore;
  const light = React.useSyncExternalStore(
    React.useCallback((listener: () => void) => {
      store?.addChangeListener?.(listener);
      return () => store?.removeChangeListener?.(listener);
    }, [store]),
    () => store?.theme === "light", () => false,
  );
  if (!enabled) return original;
  return React.createElement(View, { style: [
    { borderWidth: 1, borderRadius: 16, overflow: kind === "composer" ? "visible" : "hidden", borderColor: light ? "#5973A021" : "#6888E424", marginHorizontal: 12 },
    kind === "channels" ? { flex: 1, minHeight: 0, marginVertical: 6 } :
    kind === "header" ? { marginTop: 6, marginBottom: 6 } : { marginVertical: 4 },
  ] }, original);
}

export function startLayout(enabled: boolean, report: (error: unknown) => void): () => void {
  if (!enabled) return () => {};
  let running = true;
  let refreshQueued = false;
  const cleanup: (() => void)[] = [];
  const names = new Set(Object.keys(Names));
  const hooked = new Set<any>();
  const observed = new WeakSet<object>();
  const release = () => {
    running = false;
    for (const fn of cleanup.splice(0).reverse()) fn();
    setActive(false);
    hooked.clear();
  };
  const readSelection = () => isMidnightSelection(JSON.parse((Native.callNativeMethodSync as any)("valenced.themes.getState", [])));
  const refresh = () => {
    if (!running) return;
    try { setActive(readSelection()); }
    catch (error) { setActive(false); report(error); }
  };
  const scheduleRefresh = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    Promise.resolve().then(() => { refreshQueued = false; refresh(); });
  };
  const isThemeRoot = (value: any) => typeof value?.RootThemeContextProvider === "function" && "DisableCustomTheme" in value;
  try {
    // Validate the bridge before observing Discord. SDK export namespaces are read-only.
    readSelection();
    const filter = createFilterGenerator(
      (_args: any, _id: number, value: any) => isThemeRoot(value) || resolveTargets(value, names).length > 0,
      () => "dariuss.midnight.layout.v1", FilterScopes.Initialized,
    )();
    cleanup.push(getModules(filter, (namespace: any) => {
      if (!running) return;
      if (isThemeRoot(namespace) && !observed.has(namespace)) {
        observed.add(namespace);
        // Themes API refreshes this provider after persisting a color selection.
        // Joining its existing patch keeps the native component identity intact.
        cleanup.push(after(namespace, "RootThemeContextProvider", result => {
          scheduleRefresh();
          return result;
        }));
        refresh();
      }
      for (const { type, name } of resolveTargets(namespace, names)) {
        if (hooked.has(type)) continue;
        hooked.add(type);
        cleanup.push(afterJSX(type, element => frameElement(element, Frame, Names[name])));
      }
    }, { returnNamespace: true }));
  } catch (error) { release(); report(error); }
  return release;
}
