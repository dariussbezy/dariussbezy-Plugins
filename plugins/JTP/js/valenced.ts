import { lookupModule, getModules } from "@valenced/modules/finders";
import {
  withProps,
  createFilterGenerator,
  FilterScopes,
} from "@valenced/modules/finders/filters";
import { instead } from "@valenced/patcher";
import { Stores, onFluxEventDispatched } from "@valenced/discord/flux";
import { Design } from "@valenced/discord/design";
import {
  ActionSheetActionCreators,
  ToastActionCreators,
} from "@valenced/discord/actions";
import { getAssetIdByName } from "@valenced/assets";
type Module = Record<string, any>;
const cache = new Map<string, Module>();
let sequence = 0;
export const findAssetId = getAssetIdByName;
export const findByStoreName = (name: string) =>
  (Stores as unknown as Module)[name];
export function showToast(text: string) {
  ToastActionCreators.open(`dariuss.jump-to-ping.${++sequence}`, { text });
}
export function findByProps(...props: string[]): Module | undefined {
  if (props.includes("openLazy")) return ActionSheetActionCreators;
  if (props.includes("ActionSheet")) return Design;
  if (props.includes("ActionSheetCloseButton")) return Design;
  if (props.includes("IconButton")) return Design;
  if (props.includes("getAPIBaseURL")) {
    const [http] = lookupModule(withProps("HTTP"));
    if ((http as Module)?.HTTP?.get) return (http as Module).HTTP;
  }
  const key = props.join("|");
  if (cache.has(key)) return cache.get(key);
  const [mod] = lookupModule(withProps(...(props as [string, ...string[]])));
  if (mod) cache.set(key, mod as Module);
  return mod as Module | undefined;
}
const bellFilter = createFilterGenerator<[]>(
  (_args, _id, value: any) =>
    value?.type?.displayName === "YouBarNotificationsButton" ||
    value?.type?.name === "YouBarNotificationsButton",
  () => "dariuss.jtp.bell",
  FilterScopes.Initialized,
);
export function observeBell(wrap: (result: any, props: any) => any) {
  const patches: (() => void)[] = [];
  const seen = new WeakSet<object>();
  const remove = getModules(bellFilter(), (value) => {
    const target = value as { type: (...args: any[]) => any };
    if (!target?.type || seen.has(target)) return;
    seen.add(target);
    patches.push(
      instead(target, "type", function (args, original) {
        return wrap(Reflect.apply(original, this, args), args[0]);
      }),
    );
  });
  return () => {
    remove();
    for (const undo of patches.splice(0)) undo();
    cache.clear();
  };
}
export function subscribe(type: string, listener: (event: any) => void) {
  return onFluxEventDispatched(type, (event) => {
    listener(event);
    return event;
  });
}

/** Discord 352.6 router_utils accepts guild, channel, message and navigation options. */
export function openChannel(channelId: string, messageId?: string) {
  const channel = findByStoreName("ChannelStore")?.getChannel(channelId);
  if (!channel) throw new Error("The target channel is no longer available");
  const router = findByProps("transitionToGuild", "transitionTo");
  if (typeof router?.transitionToGuild !== "function")
    throw new Error("Discord channel routing is unavailable");
  router.transitionToGuild(channel.guild_id || "@me", channelId, messageId, {
    openChannel: true,
  });
}
