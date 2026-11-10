import * as React from "react";
import { Design } from "@valenced/discord/design";
import { NativeAction as Action, NativeRow as Row, NativeSection as Section } from "../../../shared/native-ui";
import { findByStoreName } from "./valenced";
import {
  createAccessEvaluator,
  values,
  takeValues,
  permissionNames,
  bits,
  type Role,
  type Member,
  type Overwrite,
} from "./access";
function snapshot(channelId: string) {
  const channels = findByStoreName("ChannelStore"),
    guilds = findByStoreName("GuildStore"),
    roleStore = findByStoreName("GuildRoleStore"),
    memberStore = findByStoreName("GuildMemberStore"),
    users = findByStoreName("UserStore");
  const ch = channels?.getChannel(channelId),
    gid = String(ch?.guild_id || ch?.guildId || ""),
    guild = guilds?.getGuild(gid);
  const owner = String(guild?.ownerId || guild?.owner_id || "");
  const rawRoles =
    roleStore?.getRolesSnapshot?.(gid) ??
    roleStore?.getRoles?.(gid) ??
    guild?.roles;
  const roles = new Map<string, Role>(
    values(rawRoles)
      .filter((r) => r?.id)
      .map((r) => [String(r.id), r]),
  );
  const raw = ch?.permissionOverwrites ?? ch?.permission_overwrites;
  const overwrites: Overwrite[] | null =
    raw == null ? null : values(raw).filter((o) => o?.id);
  const roleName = (id: string) =>
    id === gid ? "@everyone" : roles.get(id)?.name || `Role ${id}`;
  const memberName = (id: string, member?: any) => {
    const u = users?.getUser?.(id) || member?.user;
    return (
      member?.nick ||
      u?.globalName ||
      u?.global_name ||
      u?.username ||
      `User ${id}`
    );
  };
  const evaluate = createAccessEvaluator(gid, roles, overwrites, owner);
  const roleIds = new Set([
    ...roles.keys(),
    ...(overwrites || [])
      .filter((o) => Number(o.type) === 0)
      .map((o) => String(o.id)),
  ]);
  const allowedRoles = [...roleIds]
    .filter((id) => evaluate([id]) === true)
    .map((id) => ({
      id,
      name: roleName(id),
    }));
  const members = new Map<string, Member>();
  for (const id of [
    owner,
    ...(overwrites || [])
      .filter((o) => Number(o.type) === 1)
      .map((o) => String(o.id)),
  ]) {
    if (!id) continue;
    const m = memberStore?.getMember?.(gid, id);
    if (m) members.set(id, m);
    else if (id === owner) members.set(id, { userId: id, roles: [] });
  }
  const cached = takeValues(memberStore?.getMembers?.(gid), 501);
  for (const m of cached.slice(0, 500)) {
    const id = m?.userId || m?.user_id || m?.id || m?.user?.id;
    if (id) members.set(String(id), m);
  }
  const allowedMembers: any[] = [];
  let unknown = 0;
  for (const [id, m] of members) {
    const result = evaluate(Array.isArray(m.roles) ? m.roles : null, id);
    if (result === null) unknown++;
    if (result === true)
      allowedMembers.push({
        id,
        name: memberName(id, m),
      });
  }
  const rules = (overwrites || []).map((o) => ({
    id: `${o.type}:${o.id}`,
    name:
      Number(o.type) === 0
        ? roleName(String(o.id))
        : memberName(String(o.id), members.get(String(o.id))),
    details: `${Number(o.type) === 0 ? "Role" : "Member"} override\nAllowed: ${permissionNames(o.allow).join(", ")}\nDenied: ${permissionNames(o.deny).join(", ")}`,
  }));
  return {
    allowedRoles,
    allowedMembers,
    rules,
    rolesKnown:
      roles.has(gid) &&
      [...roleIds].every((id) => bits(roles.get(id)?.permissions) !== null),
    rulesKnown: overwrites !== null,
    cachedCount: members.size,
    limited: cached.length > 500,
    unknown,
  };
}
export default function AccessPanel({ channelId }: { channelId: string }) {
  const [roleLimit, setRoles] = React.useState(20),
    [memberLimit, setMembers] = React.useState(20),
    [ruleLimit, setRules] = React.useState(10),
    [showMembers, toggleMembers] = React.useState(false),
    [showRules, toggleRules] = React.useState(false),
    [showRoles, toggleRoles] = React.useState(false);
  const data = React.useMemo(() => {
    try {
      return snapshot(channelId);
    } catch {
      return null;
    }
  }, [channelId]);
  const note = (text: string) => <Design.Text variant="text-sm/normal">{text}</Design.Text>;
  const control = (label: string, onPress: () => void) => (
    <Action title={label} secondary compact top={0} onPress={onPress} />
  );
  const list = (items: { id: string; name: string }[]) =>
    items.map(({ id, name }) => <Design.TableRow key={id} label={name} />);
  if (!data) return note("Access details unavailable.");
  return (
    <Design.Stack>
      {control(
        `${showRoles ? "Hide" : "Show"} allowed roles · ${data.allowedRoles.length}`,
        () => toggleRoles((v) => !v),
      )}
      {showRoles ? (
        <Section title={`Allowed roles · ${data.allowedRoles.length}`}>
          <Design.Stack style={{ padding: 12 }}>
            {list(data.allowedRoles.slice(0, roleLimit))}
            {!data.rolesKnown || !data.rulesKnown
              ? note("Some access data is unavailable.")
              : !data.allowedRoles.length
                ? note("No roles found in the available data.")
                : null}
            {data.allowedRoles.length > roleLimit
              ? control("Show more roles", () => setRoles((n) => n + 20))
              : null}
          </Design.Stack>
        </Section>
      ) : null}
      {control(
        `${showMembers ? "Hide" : "Show"} members · ${data.allowedMembers.length}`,
        () => toggleMembers((v) => !v),
      )}
      {showMembers ? (
        <Section title="Allowed members">
          <Design.Stack style={{ padding: 12 }}>
            {note(
              `${data.cachedCount} members checked${data.limited ? " · scan limited to 500" : ""}${data.unknown ? ` · ${data.unknown} undetermined` : ""}. This is not a full server member list.`,
            )}
            {list(data.allowedMembers.slice(0, memberLimit))}
            {!data.allowedMembers.length
              ? note("No members identified from the available data.")
              : null}
            {data.allowedMembers.length > memberLimit
              ? control("Show more members", () => setMembers((n) => n + 20))
              : null}
          </Design.Stack>
        </Section>
      ) : null}
      {control(
        `${showRules ? "Hide" : "Show"} permissions · ${data.rules.length}`,
        () => toggleRules((v) => !v),
      )}
      {showRules ? (
        <Section title="Permission overrides">
          <Design.Stack style={{ paddingHorizontal: 14, paddingTop: 12 }}>
            {note(
              "Explicit channel rules. Unlisted permissions are inherited.",
            )}
          </Design.Stack>
          {data.rules.slice(0, ruleLimit).map((r: any) => (
            <Row
              key={r.id}
              title={r.name}
              subtitle={r.details}
              subtitleLines={100}
            />
          ))}
          {!data.rulesKnown || !data.rules.length ? (
            <Design.Stack style={{ paddingHorizontal: 14, paddingTop: 6 }}>
              {note(
                !data.rulesKnown
                  ? "Permission data unavailable."
                  : "No explicit overrides.",
              )}
            </Design.Stack>
          ) : null}
          {data.rules.length > ruleLimit ? (
            <Design.Stack style={{ padding: 12 }}>
              {control("Show more permissions", () => setRules((n) => n + 10))}
            </Design.Stack>
          ) : null}
        </Section>
      ) : null}
    </Design.Stack>
  );
}
