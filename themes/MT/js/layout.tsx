import * as React from "react";
import { Stores } from "@valenced/discord/flux";
import { getModules } from "@valenced/modules/finders";
import { createFilterGenerator, FilterScopes } from "@valenced/modules/finders/filters";
import { afterJSX } from "@valenced/react/jsx-runtime";
import { after } from "@valenced/patcher";
import * as Native from "@valenced/modules/native";
import { pluginDistDirFor } from "@valenced/plugins/constants";

export const ProviderId = "dariuss.midnight-theme";
const Names = new Set(["ChannelHeader", "ChatInput", "ChannelListLayout", "GuildsBarMessages", "ChatIcon"]);
const Surfaces = new Set(["ChannelHeader", "ChatInput", "ChannelListLayout"]);
type Element = React.ReactElement<any>;
type IconState = { active: boolean; renderer: React.ElementType<any> | null; source: { uri: string } | null };
let active = false;
let icons: IconState = { active: false, renderer: null, source: null };
let NavigationContext: React.Context<boolean> | undefined;
let reportIconError: (error: unknown) => void = () => {};
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
function setActive(value: boolean) {
  if (value === active) return;
  active = value;
  emit();
}
function setIcons(patch: Partial<IconState>) {
  if (Object.entries(patch).every(([key, value]) => icons[key as keyof IconState] === value)) return;
  icons = { ...icons, ...patch };
  emit();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const snapshot = () => active;
const iconSnapshot = () => icons;
export function isMidnightSelection(state: any): boolean {
  return state?.colors?.plugin === ProviderId;
}
export function isMidnightIconSelection(state: any): boolean {
  if (!state?.icons) return isMidnightSelection(state);
  return state.icons.plugin === ProviderId && state.icons.pack === "moon";
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
  for (const type of [namespace, namespace.default, ...Array.from(Names, name => namespace[name])]) {
    if (!type || seen.has(type)) continue;
    seen.add(type);
    const name = componentName(type);
    if (name && names.has(name)) result.push({ type, name });
  }
  return result;
}
export function decorateElement(original: Element, Decorator: React.ComponentType<any>) {
  if (!React.isValidElement(original)) return original;
  return React.createElement(Decorator, original.key === null ? { original } : { key: original.key, original });
}
function Surface({ original }: { original: Element }) {
  const enabled = React.useSyncExternalStore(subscribe, snapshot, snapshot);
  const store = (Stores as any).ThemeStore;
  const light = React.useSyncExternalStore(
    React.useCallback((listener: () => void) => {
      store?.addChangeListener?.(listener);
      return () => store?.removeChangeListener?.(listener);
    }, [store]),
    () => store?.theme === "light", () => false,
  );
  if (!enabled || original.props.style === undefined) return original;
  // Style existing surfaces without adding a Yoga parent, insets or clipping.
  return React.cloneElement(original, {
    style: [original.props.style, { borderRadius: 16, borderColor: light ? "#5973A021" : "#6888E424" }],
  });
}
function NavigationScope({ original }: { original: Element }) {
  return React.createElement(NavigationContext!.Provider, { value: true }, original);
}
class IconFallback extends React.Component<{ original: Element; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { reportIconError(error); }
  render() { return this.state.failed ? this.props.original : this.props.children; }
}
function MoonIcon({ original }: { original: Element }) {
  const navigation = React.useContext(NavigationContext!);
  const state = React.useSyncExternalStore(subscribe, iconSnapshot, iconSnapshot);
  if (!navigation || !state.active || !state.renderer || !state.source) return original;
  // Discord's BaseIconImage resolves semantic color tokens and the original icon size.
  return React.createElement(IconFallback, {
    original,
    children: React.createElement(state.renderer, { ...original.props, source: state.source, resizeMode: "contain" }),
  });
}
export function startAppearance(roundedSurfaces: boolean, report: (error: unknown) => void): () => void {
  let running = true;
  let refreshQueued = false;
  const cleanup: (() => void)[] = [];
  const hooked = new Set<any>();
  const observed = new WeakSet<object>();
  const reportSafely = (error: unknown) => { try { report(error); } catch {} };
  reportIconError = reportSafely;
  NavigationContext ??= React.createContext(false);
  const release = () => {
    running = false;
    for (const fn of cleanup.splice(0).reverse()) fn();
    setActive(false);
    setIcons({ active: false, renderer: null, source: null });
    hooked.clear();
    reportIconError = () => {};
  };
  const readSelection = () => JSON.parse((Native.callNativeMethodSync as any)("valenced.themes.getState", []));
  const refresh = () => {
    if (!running) return;
    try {
      const state = readSelection();
      setActive(roundedSurfaces && isMidnightSelection(state));
      setIcons({ active: isMidnightIconSelection(state) });
    } catch (error) {
      setActive(false);
      setIcons({ active: false });
      reportSafely(error);
    }
  };
  const scheduleRefresh = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    Promise.resolve().then(() => { refreshQueued = false; refresh(); });
  };
  const isThemeRoot = (value: any) => typeof value?.RootThemeContextProvider === "function" && "DisableCustomTheme" in value;
  const hasBaseIcon = (value: any) => componentName(value?.BaseIconImage) === "BaseIconImage";
  try {
    readSelection();
    setIcons({ source: { uri: `file://${pluginDistDirFor(ProviderId)}/assets/moon.png` } });
    const filter = createFilterGenerator(
      (_args: any, _id: number, value: any) => isThemeRoot(value) || hasBaseIcon(value) || resolveTargets(value, Names).length > 0,
      () => "dariuss.midnight.appearance.v2", FilterScopes.Initialized,
    )();
    cleanup.push(getModules(filter, (namespace: any) => {
      if (!running) return;
      try {
        if (isThemeRoot(namespace) && !observed.has(namespace)) {
          observed.add(namespace);
          cleanup.push(after(namespace, "RootThemeContextProvider", result => { scheduleRefresh(); return result; }));
          refresh();
        }
        if (hasBaseIcon(namespace)) setIcons({ renderer: namespace.BaseIconImage });
        for (const { type, name } of resolveTargets(namespace, Names)) {
          if (hooked.has(type) || (Surfaces.has(name) && !roundedSurfaces)) continue;
          hooked.add(type);
          const Decorator = name === "GuildsBarMessages" ? NavigationScope : name === "ChatIcon" ? MoonIcon : Surface;
          cleanup.push(afterJSX(type, element => decorateElement(element, Decorator)));
        }
      } catch (error) { reportSafely(error); }
    }, { returnNamespace: true }));
  } catch (error) { release(); reportSafely(error); }
  return release;
}
