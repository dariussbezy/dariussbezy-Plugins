import { getAssetIdByName } from '@valenced/assets'
import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { getModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { before, instead } from '@valenced/patcher'
import {
	cloneElement,
	createElement,
	Fragment,
	isValidElement,
	useSyncExternalStore,
} from 'react'
import { placeGroup } from './menu-order'
import type { ReactElement, ReactNode } from 'react'
import type { Entry, IgnoreScope } from './types'

export interface MenuHost {
	subscribe(listener: () => void): () => void
	version(): unknown
	nameFor(id: string): string | undefined
	isIgnored(id: string): boolean
	toggleIgnored(id: string, scope?: IgnoreScope): void
	entriesFor(channelId: string, messageId: string): readonly Entry[]
	inspect(entries: readonly Entry[]): void
	compare(entries: readonly Entry[]): void
	remove(entries: readonly Entry[]): void
	report(error: unknown): void
}

type Target = {
	id?: string
	type?: number
	guild_id?: string
	guildId?: string
}
type Context = {
	channel?: Target | string
	guild?: Target | string
	channelId?: string
	channel_id?: string
	guildId?: string
	guild_id?: string
	user?: Target
	profileUser?: Target
	userId?: string
	targetUser?: Target
	userProfile?: { user?: Target }
	message?: {
		id?: string
		channel_id?: string
		channelId?: string
		author?: Target
	}
}
type MenuRow = {
	label: string
	icon: string
	action(): void
	destructive?: boolean
}
type Props = { children?: ReactNode; items?: unknown[] }
type Component = (props: unknown) => ReactNode
type Namespace = { default?: Component; [key: string]: unknown }
type Renderer = Record<string, (...args: unknown[]) => ReactNode>

const idOf = (target: Target | string | undefined) =>
	typeof target === 'string' ? target : target?.id
const nameOf = (component: unknown) => {
	const named = component as { displayName?: string; name?: string } | null
	return named?.displayName ?? named?.name
}
const profileIdOf = (ctx: Context) =>
	ctx.user?.id ??
	ctx.profileUser?.id ??
	ctx.targetUser?.id ??
	ctx.userProfile?.user?.id ??
	ctx.userId

/** Replaces the first element `visit` returns a value for, leaving the rest of the tree intact. */
function rewrite(
	root: ReactNode,
	visit: (node: ReactElement<Props>) => ReactNode | undefined,
): ReactNode {
	let replaced = false
	function walk(node: ReactNode): ReactNode {
		if (replaced) return node
		if (Array.isArray(node)) {
			const children = node.map(walk)
			return replaced ? children : node
		}
		if (!isValidElement<Props>(node)) return node
		const result = visit(node)
		if (result !== undefined) {
			replaced = true
			return result
		}
		const children = walk(node.props.children)
		return replaced ? cloneElement(node, { children }) : node
	}
	return walk(root)
}

/** The component to patch: a plain function, or the `render`/`type` of a memo or forwardRef wrapper. */
function renderTarget(namespace: Namespace): [Renderer, string] | undefined {
	const component = namespace.default as unknown
	if (!component) return
	if (typeof component === 'function') return [namespace as Renderer, 'default']
	const wrapper = component as Record<string, unknown>
	return [
		wrapper as Renderer,
		typeof wrapper.render === 'function' ? 'render' : 'type',
	]
}

const DirectSheet =
	/^(?:Guild|Server|Channel|PrivateChannel|DM).*(?:ActionSheet|Sheet|Menu|LongPress)/i

/** Adds history and "ignore in logger" entries to Discord's long-press sheets and profile menu. */
export function installMenus(host: MenuHost) {
	let active = true
	const cleanups: (() => void)[] = []
	const patched = new WeakSet<object>()
	// Set when the outer sheet already received the rows during this render pass.
	let outerAdded = false

	function ignoreRow(id: string, scope: IgnoreScope): MenuRow {
		const name = host.nameFor(id) || `this ${scope}`
		return {
			label: host.isIgnored(id)
				? `Stop ignoring ${name} in logger`
				: `Ignore ${name} in logger`,
			icon: 'EyeSlashIcon',
			action: () => host.toggleIgnored(id, scope),
		}
	}

	function rowsFor(key: string, ctx: Context): MenuRow[] {
		const { message } = ctx
		if (
			/^(?:MessageLongPress|LongPressMessage)ActionSheet$/i.test(key) &&
			message?.id
		) {
			const channelId =
				message.channel_id ??
				message.channelId ??
				ctx.channelId ??
				ctx.channel_id ??
				idOf(ctx.channel)
			const entries = channelId ? host.entriesFor(channelId, message.id) : []
			const rows: MenuRow[] = []
			if (entries.length) {
				const deleted = entries.some(entry => entry.kind === 'deleted')
				const edited = entries.some(entry => entry.kind === 'edited')
				rows.push(
					{
						label: edited ? 'View edit history' : 'View logged message',
						icon: 'ClockIcon',
						action: () => host.inspect(entries),
					},
					...(edited
						? [
								{
									label: 'Compare edits',
									icon: 'PencilIcon',
									action: () => host.compare(entries),
								},
							]
						: []),
					{
						label: deleted ? 'Remove logged message' : 'Remove edit history',
						icon: 'TrashIcon',
						destructive: true,
						action: () => host.remove(entries),
					},
				)
			}
			if (message.author?.id) rows.push(ignoreRow(message.author.id, 'user'))
			return rows
		}
		if (
			/reaction|emoji|sticker|mute|notif|setting|permission|invite|share|report|forward|boost|onboarding|role|event|folder|thread|pin|search/i.test(
				key,
			)
		)
			return []
		if (!/LongPress|ContextMenu|ActionSheet|Sheet|Menu/i.test(key)) return []
		if (/user|profile/i.test(key)) {
			const userId = profileIdOf(ctx)
			return userId ? [ignoreRow(userId, 'user')] : []
		}
		if (/channel|^dm|directmessage/i.test(key)) {
			const channelId = idOf(ctx.channel) ?? ctx.channelId ?? ctx.channel_id
			const type =
				typeof ctx.channel === 'object' ? ctx.channel.type : undefined
			const direct =
				type === 1 ||
				type === 3 ||
				/directmessage|privatechannel|^DM/i.test(key)
			return channelId ? [ignoreRow(channelId, direct ? 'DM' : 'channel')] : []
		}
		if (/guild|server/i.test(key)) {
			const guildId = idOf(ctx.guild) ?? ctx.guildId ?? ctx.guild_id
			return guildId ? [ignoreRow(guildId, 'server')] : []
		}
		return []
	}

	function rowGroup(rows: MenuRow[], key: string) {
		return (
			<Design.ActionSheetRow.Group key="aml-menu">
				{rows.map(row => {
					const source = getAssetIdByName(row.icon)
					return (
						<Design.ActionSheetRow
							key={row.label}
							label={row.label}
							variant={row.destructive ? 'danger' : 'default'}
							icon={
								source == null ? undefined : (
									<Design.ActionSheetRow.Icon source={source} />
								)
							}
							onPress={() => {
								if (!active) return
								try {
									ActionSheetActionCreators.hideActionSheet(key)
									row.action()
								} catch (error) {
									host.report(error)
								}
							}}
						/>
					)
				})}
			</Design.ActionSheetRow.Group>
		)
	}

	function appendRows(root: ReactNode, key: string, rows: MenuRow[]) {
		return rewrite(root, node => {
			if (
				node.type !== Design.ActionSheet &&
				nameOf(node.type) !== 'ActionSheet'
			)
				return
			const children = [node.props.children].flat()
			if (
				children.some(
					child => isValidElement(child) && child.key === 'aml-menu',
				)
			)
				return node
			const group = rowGroup(rows, key)
			outerAdded = true
			return cloneElement(node, {
				children: placeGroup(children, group) ?? [...children, group],
			})
		})
	}

	/** Wraps a sheet so it re-renders with the journal and gets our rows appended. */
	function wrapSheet(
		sheet: Component,
		key: string,
		context: Context,
	): Component {
		const connected = new WeakMap<Component, Component>()
		// biome-ignore lint/correctness/noComponentHookFactories: Discord renders its sheets from patched components, so the wrapper must be built at runtime.
		return function LoggerSheet(props) {
			useSyncExternalStore(host.subscribe, host.version, host.version)
			outerAdded = false
			const tree = sheet(props)
			if (!active) return tree
			try {
				const rows = rowsFor(key, { ...context, ...(props as Context) })
				if (rows.length) {
					const result = appendRows(tree, key, rows)
					if (outerAdded) return result
				}
				// Server and channel sheets render their content inside a connected child.
				return rewrite(tree, node => {
					if (
						typeof node.type !== 'function' ||
						!/(?:Channel|Guild|Server|PrivateChannel|DM).*Connected$/.test(
							nameOf(node.type) ?? '',
						)
					)
						return
					const Inner = node.type as Component
					let Wrapped = connected.get(Inner)
					if (!Wrapped) {
						// biome-ignore lint/correctness/noComponentHookFactories: the connected child is only known at runtime.
						Wrapped = function LoggerConnectedSheet(innerProps) {
							useSyncExternalStore(host.subscribe, host.version, host.version)
							const child = Inner(innerProps)
							if (!active) return child
							try {
								const current = rowsFor(key, {
									...context,
									...(innerProps as Context),
								})
								return current.length ? appendRows(child, key, current) : child
							} catch (error) {
								host.report(error)
								return child
							}
						}
						connected.set(Inner, Wrapped)
					}
					return createElement(Wrapped, { ...node.props, key: node.key })
				})
			} catch (error) {
				host.report(error)
				return tree
			}
		}
	}

	function patchProfileMenu(namespace: Namespace) {
		const target = renderTarget(namespace)
		if (!active || !target) return
		const [owner, field] = target
		if (typeof owner[field] !== 'function' || patched.has(owner)) return
		try {
			cleanups.push(
				instead(owner, field, function (args, original) {
					useSyncExternalStore(host.subscribe, host.version, host.version)
					const tree = Reflect.apply(original, this, args)
					const id = profileIdOf((args[0] ?? {}) as Context)
					if (!active || !id) return tree
					try {
						return rewrite(tree, node => {
							// The native ContextMenu can sit behind memo or connected wrappers.
							if (!Array.isArray(node.props.items)) return
							const { label, action } = ignoreRow(id, 'user')
							if (
								node.props.items.some(
									item => (item as { label?: string })?.label === label,
								)
							)
								return node
							return cloneElement(node, {
								items: [...node.props.items, { label, action }],
							})
						})
					} catch (error) {
						host.report(error)
						return tree
					}
				}),
			)
			patched.add(owner)
		} catch (error) {
			host.report(error)
		}
	}

	/**
	 * The server sheet is not an ActionSheet: it lists the components exported by
	 * GuildActionSheetActions in a plain view, so the row group is added after the first of them.
	 */
	function watchGuildActions() {
		return getModules(
			withProps<Record<string, unknown>>('GuildActionSheetPrimaryActions'),
			actions => {
				if (!active || patched.has(actions)) return
				try {
					cleanups.push(
						instead(
							actions as Record<string, (...args: unknown[]) => ReactNode>,
							'GuildActionSheetPrimaryActions',
							function (args, original) {
								useSyncExternalStore(host.subscribe, host.version, host.version)
								const tree = Reflect.apply(original, this, args)
								if (!active) return tree
								try {
									const guildId = idOf(
										(args[0] as { guild?: Target } | undefined)?.guild,
									)
									return guildId
										? createElement(
												Fragment,
												null,
												tree,
												rowGroup(
													[ignoreRow(guildId, 'server')],
													`GuildActionSheet:${guildId}`,
												),
											)
										: tree
								} catch (error) {
									host.report(error)
									return tree
								}
							},
						),
					)
					patched.add(actions)
				} catch (error) {
					host.report(error)
				}
			},
		)
	}

	function watchSheet(name: string, key: string) {
		return getModules(
			withName(name),
			namespace => {
				const target = active && renderTarget(namespace as Namespace)
				if (!target) return
				const [owner, field] = target
				if (typeof owner[field] !== 'function' || patched.has(owner)) return
				try {
					const wrappers = new WeakMap<Component, Component>()
					cleanups.push(
						instead(owner, field, ([props], original) => {
							let wrapped = wrappers.get(original as Component)
							if (!wrapped) {
								wrapped = wrapSheet(original as Component, key, {})
								wrappers.set(original as Component, wrapped)
							}
							return wrapped(props)
						}),
					)
					patched.add(owner)
				} catch (error) {
					host.report(error)
				}
			},
			{ returnNamespace: true },
		)
	}

	try {
		cleanups.push(
			// Sheets opened lazily by Discord never match a name finder, so wrap their promise.
			before(ActionSheetActionCreators, 'openLazy', args => {
				const [promise, key, context] = args
				if (
					!active ||
					typeof (promise as Promise<unknown> | undefined)?.then !==
						'function' ||
					typeof key !== 'string'
				)
					return args
				const ctx = (context ?? {}) as Context
				try {
					if (!rowsFor(key, ctx).length && !DirectSheet.test(key)) return args
				} catch (error) {
					host.report(error)
					return args
				}
				args[0] = (promise as Promise<Namespace>).then(module =>
					active && typeof module?.default === 'function'
						? { ...module, default: wrapSheet(module.default, key, ctx) }
						: module,
				) as typeof promise
				return args
			}),
		)
		cleanups.push(
			getModules(
				withName('UserProfileOverflowMenu'),
				namespace => patchProfileMenu(namespace as Namespace),
				{ returnNamespace: true },
			),
		)
		cleanups.push(
			watchSheet('LongPressMessageActionSheet', 'MessageLongPressActionSheet'),
			watchSheet('ChannelLongPressActionSheet', 'ChannelLongPressActionSheet'),
			watchSheet('GuildActionSheet', 'GuildActionSheet'),
			watchGuildActions(),
			watchSheet('GuildLongPressActionSheet', 'GuildLongPressActionSheet'),
			watchSheet('DMListLongPressActionSheet', 'DMListLongPressActionSheet'),
		)
	} catch (error) {
		host.report(error)
	}

	return () => {
		active = false
		for (const cleanup of cleanups.splice(0).reverse()) {
			try {
				cleanup()
			} catch (error) {
				host.report(error)
			}
		}
	}
}
