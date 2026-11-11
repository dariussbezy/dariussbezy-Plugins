import { Design } from "@valenced/discord/design";
import { BottomSheet } from "@valenced/externals/gorhom";
import {
  NativeSection as CustomSection,
  NativeRow as CustomRow,
  NativeSwitch as CustomSwitch,
  NativeAction as CustomAction,
  NativeIconControl,
  rowIcon,
  settingsContent,
  useSheetBottomPadding,
  NativeGuide as KitGuide,
} from "../../../shared/native-ui";
import * as React from "react";
import * as RN from "react-native";
import {
  findByProps,
  openChannel,
  findByStoreName,
  findAssetId,
  observeBell,
  subscribe,
  showToast,
} from "./valenced";
import { createPluginStore } from "./settings-store";
const pingStore = createPluginStore("jumptoping", {
  hideWhenEmpty: true,
  showBadge: true,
  includeDMs: false,
});
const implementation = (() => {
  const BUILD = "1.0.2-beta";
  const SHEET_KEY = "jump-to-ping";
  const MAX_CHANNELS = 300;
  const PER_CHANNEL = 25;
  const SNIPPET = 160;
  const RED = "#ED4245";
  const ICON_CANDIDATES = [
    "AtIcon",
    "MentionIcon",
    "ChatMarkUnreadIcon",
    "BellIcon",
  ];

  const unpatches = [];
  const listeners = new Set();
  const captured = new Map();
  let ReadStateStore;
  let MessageStore;
  let UserStore;
  let ChannelStore;
  let GuildStore;
  let notifyTimer = null;
  let activeFetches = 0;
  let generation = 0;
  const waitTimers = new Map();
  function delay(fn, ms) {
    const id = setTimeout(() => {
      waitTimers.delete(id);
      if (loadRequested) fn();
    }, ms);
    waitTimers.set(id, null);
    return id;
  }
  const resolved = new Map();
  const inflight = new Set();
  const failedAt = new Map();
  const pending = [];
  let hydrationUnsubscribe = null;
  let loadRequested = false;
  let initialized = false;
  let partsCache = null;

  const cfg = () => pingStore.useStore.getState();
  const setSetting = (key, value) =>
    pingStore.useStore.getState().updateSettings({ [key]: value });
  const toast = (t) => {
    try {
      showToast(t);
    } catch (_) {}
  };
  const clip = (s, n) => String(s == null ? "" : s).slice(0, n);


  const kitAssetCache = new Map();
  function kitAsset(name) {
    const hit = kitAssetCache.get(name);
    if (hit && (hit.id || Date.now() - hit.at < 5000)) return hit.id;
    let id = null;
    try {
      id = findAssetId(name);
    } catch (_) {
      id = null;
    }
    kitAssetCache.set(name, { id, at: Date.now() });
    return id;
  }
  /* ---- ping data ---- */
  function fmtTime(ms) {
    const d = new Date(ms);
    const p = (n) => (n < 10 ? "0" : "") + n;
    const t = p(d.getHours()) + ":" + p(d.getMinutes());
    if (d.toDateString() === new Date().toDateString()) return t;
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + " " + t;
  }
  function nameOf(u) {
    if (!u) return "Unknown";
    return u.globalName || u.global_name || u.username || "Unknown";
  }
  function loadStores() {
    ReadStateStore = ReadStateStore || findByStoreName("ReadStateStore");
    MessageStore = MessageStore || findByStoreName("MessageStore");
    UserStore = UserStore || findByStoreName("UserStore");
    ChannelStore = ChannelStore || findByStoreName("ChannelStore");
    GuildStore = GuildStore || findByStoreName("GuildStore");
    return !!(ReadStateStore && UserStore && ChannelStore);
  }
  const getChannel = (id) => {
    try {
      return id ? ChannelStore.getChannel(id) : null;
    } catch (_) {
      return null;
    }
  };
  const isDM = (ch) => !!ch && (ch.type === 1 || ch.type === 3);
  const myId = () => {
    try {
      return UserStore.getCurrentUser()?.id || null;
    } catch (_) {
      return null;
    }
  };
  const gte = (a, b) => {
    a = String(a);
    b = String(b);
    return a.length !== b.length ? a.length > b.length : a >= b;
  };
  const snowflakeTime = (id) => {
    const n = Number(id);
    return n > 0 ? Math.floor(n / 4194304) + 1420070400000 : 0;
  };

  function channelLabel(channelId, guildId) {
    const ch = getChannel(channelId);
    if (!ch) return "Unknown channel";
    if (isDM(ch)) {
      let name = ch.name;
      if (!name) {
        try {
          name = (ch.recipients || [])
            .map((id) => UserStore.getUser(id)?.username)
            .filter(Boolean)
            .join(", ");
        } catch (_) {}
      }
      return "DM \u00B7 " + (name || "Unknown");
    }
    let guild = null;
    try {
      guild = GuildStore && GuildStore.getGuild(guildId || ch.guild_id)?.name;
    } catch (_) {}
    return "#" + (ch.name || "channel") + (guild ? " \u00B7 " + guild : "");
  }

  function cleanText(raw) {
    let s = String(raw == null ? "" : raw);
    s = s.replace(/<@!?(\d+)>/g, (m0, id) => {
      try {
        const u = UserStore.getUser(id);
        return "@" + (u ? nameOf(u) : "user");
      } catch (_) {
        return "@user";
      }
    });
    s = s.replace(/<@&(\d+)>/g, "@role");
    s = s.replace(/<#(\d+)>/g, (m0, id) => {
      const c = getChannel(id);
      return "#" + ((c && c.name) || "channel");
    });
    s = s
      .replace(/<a?:(\w+):\d+>/g, ":$1:")
      .replace(/\s+/g, " ")
      .trim();
    return clip(s, SNIPPET);
  }

  function pingKind(m, ch, me) {
    if (!m || !m.author || m.author.id === me) return null;
    if (isDM(ch)) return "dm";
    const ref =
      (m.referencedMessage &&
        (m.referencedMessage.message || m.referencedMessage)) ||
      m.referenced_message;
    if (ref && ref.author && ref.author.id === me) return "reply";
    if (m.mentioned === true) return "mention";
    try {
      for (const u of m.mentions || [])
        if ((typeof u === "string" ? u : u && u.id) === me) return "mention";
    } catch (_) {}
    if (m.mention_everyone === true || m.mentionEveryone === true)
      return "mention";
    return null;
  }

  function entryFrom(m, kind) {
    const text =
      cleanText(m.content) ||
      (m.attachments && m.attachments.length
        ? "(attachment)"
        : m.embeds && m.embeds.length
          ? "(embed)"
          : "");
    return {
      id: String(m.id),
      at: snowflakeTime(m.id),
      an: nameOf(m.author),
      t: text,
      k: kind,
    };
  }

  function capture(e) {
    const m = e && e.message;
    if (!m || !m.id) return;
    const channelId = String(m.channel_id || m.channelId || e.channelId || "");
    const me = myId();
    if (!channelId || !me) return;
    const kind = pingKind(m, getChannel(channelId), me);
    if (!kind) return;
    const list = captured.get(channelId) || [];
    if (list.some((x) => x.id === String(m.id))) return;
    list.push(entryFrom(m, kind));
    if (list.length > PER_CHANNEL) list.splice(0, list.length - PER_CHANNEL);
    captured.delete(channelId);
    captured.set(channelId, list);
    while (captured.size > MAX_CHANNELS)
      captured.delete(captured.keys().next().value);
  }
  function ack(channelId, messageId) {
    if (!channelId) return;
    const key = String(channelId);
    const list = captured.get(key);
    if (!list) return;
    const kept = messageId ? list.filter((x) => !gte(messageId, x.id)) : [];
    if (kept.length) captured.set(key, kept);
    else captured.delete(key);
  }
  function drop(channelId, id) {
    if (!channelId || !id) return;
    const key = String(channelId);
    const list = captured.get(key);
    if (!list) return;
    const cached = resolved.get(key);
    if (cached?.entry?.id === String(id)) resolved.delete(key);
    const kept = list.filter((x) => x.id !== String(id));
    if (kept.length) captured.set(key, kept);
    else captured.delete(key);
  }
  function schedule() {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      for (const fn of Array.from(listeners)) {
        try {
          fn();
        } catch (_) {}
      }
    }, 80);
  }
  function hookDispatch(args) {
    const e = args && args[0];
    if (!e || e.loggerRemoval) return;
    try {
      if (e.type === "MESSAGE_CREATE") capture(e);
      else if (e.type === "MESSAGE_ACK" || e.type === "CHANNEL_ACK")
        ack(e.channelId || e.channel_id, e.messageId || e.message_id);
      else if (e.type === "MESSAGE_DELETE") drop(e.channelId, e.id);
      else if (e.type === "MESSAGE_DELETE_BULK") {
        for (const id of e.ids || []) drop(e.channelId, id);
      } else if (e.type !== "CHANNEL_SELECT" && e.type !== "CONNECTION_OPEN")
        return;
    } catch (_) {}
    schedule();
  }

  function loadedMention(channelId, oldest) {
    if (!oldest) return null;
    try {
      const ms = MessageStore && MessageStore.getMessages(channelId);
      const arr =
        (ms && (typeof ms.toArray === "function" ? ms.toArray() : ms._array)) ||
        [];
      const me = myId();
      const ch = getChannel(channelId);
      for (const m of arr) {
        if (!m || !m.id || !gte(m.id, oldest)) continue;
        const kind = pingKind(m, ch, me);
        if (kind) return entryFrom(m, kind);
      }
    } catch (_) {}
    return null;
  }
  function pickMessage(channelId, oldest) {
    const list = captured.get(String(channelId)) || [];
    const fresh = oldest ? list.filter((x) => gte(x.id, oldest)) : list;
    if (fresh.length) return fresh[0];
    return loadedMention(channelId, oldest);
  }

  /* ---- resolve the real ping message (preview + exact jump target) ---- */
  function decId(id) {
    const a = String(id).split("");
    let i = a.length - 1;
    while (i >= 0) {
      if (a[i] === "0") {
        a[i] = "9";
        i--;
      } else {
        a[i] = String(Number(a[i]) - 1);
        break;
      }
    }
    return a.join("").replace(/^0+(?=\d)/, "");
  }
  function restApi() {
    try {
      const m = findByProps("getAPIBaseURL", "del");
      return m && typeof m.get === "function" ? m : null;
    } catch (_) {
      return null;
    }
  }
  const requests = new Map();
  function fetchPing(channelId, oldest) {
    const key = `${generation}:${channelId}:${oldest}`;
    if (requests.has(key)) return requests.get(key);
    const request = fetchPingPage(channelId, oldest).finally(() =>
      requests.delete(key),
    );
    requests.set(key, request);
    return request;
  }
  async function fetchPingPage(channelId, oldest) {
    const api = restApi();
    if (!api) throw new Error("no api");
    const epoch = generation;
    const ch = getChannel(channelId),
      me = myId();
    let after = decId(oldest);
    for (let page = 0; page < 3; page++) {
      const res = await api.get({
        url: "/channels/" + channelId + "/messages",
        query: { limit: 50, after },
      });
      if (!loadRequested || epoch !== generation)
        throw new Error("Request cancelled");
      const list = ((res && (res.body || res.data)) || [])
        .filter((m) => m && m.id)
        .slice()
        .sort((x, y) => (x.id === y.id ? 0 : gte(x.id, y.id) ? 1 : -1));
      for (const m of list) {
        const kind = pingKind(m, ch, me);
        if (kind) return entryFrom(m, kind);
      }
      if (list.length < 50) break;
      after = list[list.length - 1].id;
    }
    return null;
  }
  function remember(channelId, oldest, entry) {
    resolved.delete(String(channelId));
    resolved.set(String(channelId), { oldest: String(oldest), entry });
    while (resolved.size > MAX_CHANNELS)
      resolved.delete(resolved.keys().next().value);
  }
  function pump() {
    while (loadRequested && activeFetches < 3 && pending.length) {
      const r = pending.shift(),
        epoch = generation;
      activeFetches++;
      fetchPing(r.c, r.oldest)
        .then(
          (entry) => {
            if (epoch !== generation || !loadRequested) return;
            remember(r.c, r.oldest, entry);
            failedAt.delete(r.c);
          },
          () => {
            if (epoch === generation && loadRequested)
              failedAt.set(r.c, Date.now());
          },
        )
        .finally(() => {
          if (epoch !== generation || !loadRequested) return;
          inflight.delete(r.c);
          activeFetches--;
          schedule();
          pump();
        });
    }
  }
  function resolveRows(rows) {
    for (const r of rows.filter((x) => x.needs).slice(0, 15)) {
      if (inflight.has(r.c)) continue;
      const failed = failedAt.get(r.c);
      if (failed && Date.now() - failed < 30000) continue;
      inflight.add(r.c);
      pending.push(r);
    }
    pump();
  }
  async function ensureResolved(r) {
    const cached = resolved.get(r.c);
    if (cached && cached.oldest === String(r.oldest)) return cached.entry;
    const epoch = generation;
    try {
      const entry = await fetchPing(r.c, r.oldest);
      if (!loadRequested || epoch !== generation) return null;
      remember(r.c, r.oldest, entry);
      schedule();
      return entry;
    } catch (_) {
      return null;
    }
  }

  function getRows() {
    if (!ReadStateStore) return [];
    let ids = [];
    try {
      ids = ReadStateStore.getMentionChannelIds
        ? Array.from(ReadStateStore.getMentionChannelIds())
        : Array.from(captured.keys());
    } catch (_) {
      ids = Array.from(captured.keys());
    }
    const rows = [];
    for (const channelId of ids) {
      let count = 0;
      try {
        count = ReadStateStore.getMentionCount(channelId) || 0;
      } catch (_) {}
      if (count <= 0) continue;
      const ch = getChannel(channelId);
      const dm = isDM(ch);
      if (dm && !cfg().includeDMs) continue;
      let oldest = null;
      try {
        oldest = ReadStateStore.getOldestUnreadMessageId
          ? ReadStateStore.getOldestUnreadMessageId(channelId)
          : null;
      } catch (_) {}
      let hit = pickMessage(channelId, oldest);
      let needs = false;
      if (!hit && oldest) {
        const cached = resolved.get(String(channelId));
        if (cached && cached.oldest === String(oldest)) hit = cached.entry;
        else needs = true;
      }
      const id = hit ? hit.id : oldest || null;
      rows.push({
        c: String(channelId),
        g: (ch && ch.guild_id) || null,
        count,
        id,
        oldest,
        needs,
        an: (hit && hit.an) || "",
        t: (hit && hit.t) || "",
        k: (hit && hit.k) || (dm ? "dm" : "mention"),
        dm,
        at: (hit && hit.at) || (id ? snowflakeTime(id) : 0),
      });
    }
    rows.sort((a, b) => (b.at || 0) - (a.at || 0));
    return rows;
  }
  const totalOf = (rows) => rows.reduce((n, r) => n + r.count, 0);

  /* ---- jump + sheet ---- */
  function sheetParts() {
    if (partsCache && partsCache.ActionSheet) return partsCache;
    let ActionSheet = null;
    try {
      const a = findByProps("ActionSheet");
      ActionSheet = (a && a.ActionSheet) || null;
    } catch (_) {}
    partsCache = { ActionSheet };
    return partsCache;
  }
  function closeSheet() {
    try {
      const s = findByProps("openLazy", "hideActionSheet");
      s && s.hideActionSheet && s.hideActionSheet(SHEET_KEY);
    } catch (_) {}
  }
  function jumpTo(channelId, messageId) {
    if (!channelId) return;
    closeSheet();
    delay(() => {
      try {
        openChannel(
          String(channelId),
          messageId ? String(messageId) : undefined,
        );
      } catch (error) {
        console.error("Jump to Ping: navigation failed", error);
        toast("Could not open this chat");
      }
    }, 220);
  }
  function jumpToPing(r) {
    if (!r) return;
    if (!r.needs) {
      jumpTo(r.c, r.id);
      return;
    }
    const epoch = generation;
    ensureResolved(r).then((e) => {
      if (loadRequested && epoch === generation) jumpTo(r.c, e ? e.id : r.id);
    });
  }

  function rowSubtitle(r) {
    const what = r.dm
      ? r.count === 1
        ? "unread message"
        : "unread messages"
      : r.count === 1
        ? "unread ping"
        : "unread pings";
    const meta =
      r.count + " " + what + (r.at ? " \u00B7 " + fmtTime(r.at) : "");
    const lead = r.t ? (r.an ? r.an + ": " : "") + r.t : "";
    return lead ? lead + "\n" + meta : meta;
  }

  function PingSheet() {
    const h = React.createElement;
    const [, bump] = React.useState(0);
    const [expanded, setExpanded] = React.useState(false);
    const [headerHeight, setHeaderHeight] = React.useState(88);
    const [firstRowsHeight, setFirstRowsHeight] = React.useState(252);
    const { height: windowHeight } = RN.useWindowDimensions();
    React.useEffect(() => {
      const fn = () => bump((x) => x + 1);
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    }, []);
    const rows = getRows();
    const total = totalOf(rows);
    const parts = sheetParts();
    React.useEffect(() => {
      resolveRows(rows);
    }, [rows.map((r) => r.c + ":" + (r.needs ? 1 : 0)).join("|")]);
    const bottomPadding = useSheetBottomPadding();
    const maxHeight = Math.floor(windowHeight * 0.85);
    const initialHeight = Math.min(maxHeight, headerHeight + firstRowsHeight + bottomPadding + 24);
    const viewportHeight = Math.max(80, (expanded ? maxHeight : initialHeight) - headerHeight - bottomPadding - 24);
    const subtitle = rows.length
      ? total +
        (total === 1 ? " unread ping" : " unread pings") +
        " in " +
        rows.length +
        (rows.length === 1 ? " chat" : " chats")
      : "You are all caught up";
    const body = h(
      Design.Stack,
      { spacing: 12, style: { paddingBottom: bottomPadding } },
      h(RN.View, { onLayout: event => setHeaderHeight(Math.ceil(event.nativeEvent.layout.height)) },
        h(Design.BottomSheetTitleHeader, { title: "Pings", subtitle })),
      rows.length
        ? h(
            BottomSheet.BottomSheetScrollView,
            { style: { height: viewportHeight, flexGrow: 0 }, keyboardShouldPersistTaps: "handled" },
            h(RN.View, { onLayout: event => setFirstRowsHeight(Math.ceil(event.nativeEvent.layout.height)) },
            h(
              Design.TableRowGroup,
              null,
              ...rows.slice(0, 3).map((row) => h(Design.TableRow, {
                key: row.c,
                label: channelLabel(row.c, row.g),
                icon: rowIcon(row.dm ? "chat" : "at"),
                subLabel: rowSubtitle(row),
                subLabelLineClamp: 2,
                arrow: true,
                onPress: () => jumpToPing(row),
              })),
            )),
            rows.length > 3 ? h(Design.TableRowGroup, null,
              ...rows.slice(3).map(row => h(Design.TableRow, {
                key: row.c, label: channelLabel(row.c, row.g),
                icon: rowIcon(row.dm ? "chat" : "at"), subLabel: rowSubtitle(row),
                subLabelLineClamp: 2, arrow: true, onPress: () => jumpToPing(row),
              }))) : null,
          )
        : null,
    );
    return parts.ActionSheet ? h(parts.ActionSheet, {
      scrollable: true, startExpanded: false, startHeight: initialHeight,
      maxHeight, contentHeight: maxHeight - 24,
      onExpand: () => setExpanded(true),
    }, body) : body;
  }

  function fallbackMenu() {
    const rows = getRows();
    if (!rows.length) {
      toast("No unread pings");
      return;
    }
    try {
      const sheets = findByProps("showSimpleActionSheet");
      if (sheets && typeof sheets.showSimpleActionSheet === "function") {
        sheets.showSimpleActionSheet({
          key: SHEET_KEY,
          header: { title: "Pings" },
          options: rows.slice(0, 20).map((r) => ({
            label: channelLabel(r.c, r.g) + " (" + r.count + ")",
            onPress: () => jumpToPing(r),
          })),
        });
        return;
      }
    } catch (_) {}
    toast("Could not open the ping list");
  }
  function openPings() {
    try {
      const sheets = findByProps("openLazy", "hideActionSheet");
      if (
        sheets &&
        typeof sheets.openLazy === "function" &&
        sheetParts().ActionSheet
      ) {
        sheets.openLazy(Promise.resolve({ default: PingSheet }), SHEET_KEY, {});
        return;
      }
    } catch (_) {}
    fallbackMenu();
  }
  function jumpToNewest() {
    const rows = getRows();
    if (!rows.length) {
      toast("No unread pings");
      return;
    }
    jumpToPing(rows[0]);
  }

  /* ---- profile bar button ---- */
  function pingIcon() {
    for (const name of ICON_CANDIDATES) {
      const id = kitAsset(name);
      if (id) return id;
    }
    return null;
  }
  function PingButton(p) {
    const h = React.createElement;
    const [, bump] = React.useState(0);
    React.useEffect(() => {
      const fn = () => bump((x) => x + 1);
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    }, []);
    const rows = getRows();
    if (!rows.length && cfg().hideWhenEmpty) return null;
    const asset = pingIcon();
    if (!asset) return null;
    const hasNp = !!p.hasNameplate;
    const total = totalOf(rows);
    return h(
      RN.View,
      null,
      h(NativeIconControl, {
        variant: hasNp ? "secondary-overlay" : "tertiary",
        icon: asset,
        label: "Pings",
        holdLabel: "Jump to newest ping",
        onPress: openPings,
        onLongPress: jumpToNewest,
      }),
      cfg().showBadge && total > 0
        ? h(
            RN.View,
            {
              pointerEvents: "none",
              style: {
                position: "absolute",
                top: -3,
                right: -3,
                minWidth: 16,
                height: 16,
                borderRadius: 8,
                paddingHorizontal: 4,
                backgroundColor: RED,
                alignItems: "center",
                justifyContent: "center",
              },
            },
            h(
              Design.Text,
              { style: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" } },
              total > 99 ? "99+" : String(total),
            ),
          )
        : null,
    );
  }
  function patchYouBar() {
    unpatches.push(
      observeBell((original, props) =>
        React.createElement(
          React.Fragment,
          null,
          React.createElement(PingButton, {
            hasNameplate: !!props?.hasNameplate,
          }),
          original,
        ),
      ),
    );
    return true;
  }
  /* ---- settings ---- */
  function Settings() {
    pingStore.useStore();
    const [, bump] = React.useState(0);
    const h = React.createElement;
    const s = cfg();
    const toggle = (key, title, subtitle, icon, last) =>
      h(CustomRow, {
        key,
        title,
        subtitle,
        icon,
        last: !!last,
        trailing: h(CustomSwitch, {
          value: !!s[key],
          onChange: (v) => {
            setSetting(key, v);
            bump((x) => x + 1);
            schedule();
          },
        }),
      });
    const guide = h(KitGuide, {
      key: "guide",
      title: "Quick guide",
      steps: [
        [
          "Where the button is",
          "When you have unread pings, a button appears in your profile bar next to the notifications bell. Tap it to open the list. Long-press it to jump straight to the newest ping.",
        ],
        [
          "Reading the list",
          "Each row is a chat with unread pings: a mention, a reply to you or a DM. You see the chat, who wrote, a short preview and the time. The red number on the button counts unread pings in the listed chats.",
        ],
        [
          "Jump to",
          "Tap the row to open the chat and scroll to the first unread ping. Uncached pings are resolved from recent channel messages; if no exact match is found, the chat opens at its oldest unread message.",
        ],
        [
          "When pings disappear",
          "The list follows Discord's own unread counters, so a chat leaves the list as soon as you read it in Discord. Turn off Only show with pings if you want the button to stay visible all the time.",
        ],
      ],
    });
    return h(
      RN.ScrollView,
      {
        style: { flex: 1 },
        keyboardShouldPersistTaps: "handled",
        contentContainerStyle: settingsContent,
      },
      h(
        CustomSection,
        { key: "button", title: "Button" },
        toggle(
          "hideWhenEmpty",
          "Only show with pings",
          "Hide the button when you have no unread pings.",
          "bell",
        ),
        toggle(
          "showBadge",
          "Show count badge",
          "Show the number of unread pings on the button.",
          "at",
          true,
        ),
      ),
      h(
        CustomSection,
        { key: "list", title: "List" },
        toggle(
          "includeDMs",
          "Include DMs",
          "List unread direct messages as pings.",
          "chat",
          true,
        ),
      ),
      h(
        CustomSection,
        { key: "preview", title: "Preview" },
        h(CustomAction, {
          title: "Open ping list",
          icon: "at",
          top: 0,
          secondary: true,
          onPress: openPings,
        }),
      ),
      guide,
      h(
        Design.Text,
        {
          style: {
            fontSize: 12,
            textAlign: "center",
            marginTop: 1,
            opacity: 0.7,
          },
        },
        "Jump to Ping " + BUILD,
      ),
    );
  }

  function initializeAfterHydration() {
    if (!loadRequested || initialized) return;
    initialized = true;
    const s = cfg();
    const defaults = {
      hideWhenEmpty: true,
      showBadge: true,
      includeDMs: false,
    };
    const missing = {};
    for (const k of Object.keys(defaults))
      if (s[k] === undefined) missing[k] = defaults[k];
    if (Object.keys(missing).length)
      pingStore.useStore.getState().updateSettings(missing);
    if (!loadStores()) {
      toast("Jump to Ping: required Discord modules not found");
      return;
    }
    captured.clear();
    for (const type of [
      "MESSAGE_CREATE",
      "MESSAGE_ACK",
      "CHANNEL_ACK",
      "MESSAGE_DELETE",
      "MESSAGE_DELETE_BULK",
      "CHANNEL_SELECT",
      "CONNECTION_OPEN",
    ])
      unpatches.push(subscribe(type, (event) => hookDispatch([event])));
    if (!patchYouBar()) toast("Jump to Ping: could not find the profile bar");
    schedule();
  }

  function onLoad() {
    generation++;
    loadRequested = true;
    const store = pingStore.useStore;
    const current = store.getState();
    if (current._hasHydrated) {
      initializeAfterHydration();
      return;
    }

    const checkHydration = (state) => {
      if (!loadRequested || !state._hasHydrated) return;
      if (hydrationUnsubscribe) hydrationUnsubscribe();
      hydrationUnsubscribe = null;
      initializeAfterHydration();
    };
    hydrationUnsubscribe = store.subscribe(checkHydration);
    // Recheck after subscribing so hydration cannot finish between the first
    // check and subscription registration.
    checkHydration(store.getState());
  }

  function onUnload() {
    generation++;
    loadRequested = false;
    for (const timer of waitTimers.keys()) clearTimeout(timer);
    waitTimers.clear();
    if (hydrationUnsubscribe) {
      hydrationUnsubscribe();
      hydrationUnsubscribe = null;
    }
    initialized = false;
    for (const u of unpatches.splice(0)) {
      try {
        u();
      } catch (_) {}
    }
    if (notifyTimer) {
      clearTimeout(notifyTimer);
      notifyTimer = null;
    }
    closeSheet();
    listeners.clear();
    captured.clear();
    requests.clear();
    resolved.clear();
    inflight.clear();
    failedAt.clear();
    pending.length = 0;
    activeFetches = 0;
    try {
      UserStore && UserStore.emitChange && UserStore.emitChange();
    } catch (_) {}
  }

  return { onLoad, onUnload, settings: Settings };
})();
export default implementation;
export const useSettings = pingStore.useStore;
