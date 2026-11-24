import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after, instead } from '@valenced/patcher'
import { cloneElement, isValidElement } from 'react'
import { startStats } from '../../../lib/stats'
import manifest from '../manifest.json'
import SettingsComponent from './settings'
import {
	bindStorage,
	DefaultSettings,
	getSettings,
	keyOf,
	lookups,
	measured,
	mergedFor,
	placeOf,
	resolve,
} from './shared'
import type { ReactElement, ReactNode } from 'react'
import type { EmojiPicker, RowEmoji, Settings, UnicodeEmojis } from './shared'

type ReactionRow = {
	useEmojisForReactionRow: (
		channel: {
			id?: string
			guild_id?: string | null
			getGuildId?(): string | null | undefined
		},
		maxWidth: number,
		slotWidth: number,
	) => (RowEmoji | null)[]
}

type FrequentEmojis = {
	useFrequentlyUsedReactionEmojis: (guildId: unknown) => RowEmoji[]
}

type Row = ReactElement<{ children?: ReactNode; style?: unknown }>

const frequent: { hook?: FrequentEmojis['useFrequentlyUsedReactionEmojis'] } =
	{}
/** EmojiIntention.REACTION. */
const ReactionIntention = 0
const emojiRules: {
	locked?: (args: {
		emoji: RowEmoji
		channel: unknown
		intention: number
	}) => boolean
} = {}

/** Spots in one row (emojis plus the picker button), from the last time the row was built. */
let slots = 0

/**
 * Every spot of the quick reactions, row after row: your emoji where you put one, otherwise the
 * next frequent emoji (when filling is on). The picker button takes the very last spot.
 */
function arrange(
	base: (RowEmoji | null)[],
	more: RowEmoji[],
	channel: Parameters<ReactionRow['useEmojisForReactionRow']>[0],
) {
	const { rows } = getSettings()
	// The server's or DM's own emojis, with the ones set for everywhere on the spots it leaves empty.
	const { emojis, fill } = mergedFor(placeOf(channel))
	const total = rows * slots - 1
	if (!emojis.length && rows === 1) return base
	// Discord hides emojis it would refuse as reactions here (locked, Nitro-only): so does this row.
	const usable = (emoji: RowEmoji) =>
		(emoji as { available?: boolean }).available !== false &&
		!emojiRules.locked?.({ emoji, channel, intention: ReactionIntention })
	const saved = emojis.map(spot => {
		const emoji = spot ? resolve(spot) : null
		return emoji && usable(emoji) ? emoji : null
	})
	const taken = new Set(
		saved.filter((emoji): emoji is RowEmoji => emoji != null).map(keyOf),
	)
	const pool: RowEmoji[] = []
	if (fill || !emojis.length)
		for (const emoji of [...base, ...more]) {
			if (!emoji || !usable(emoji)) continue
			const key = keyOf(emoji)
			if (taken.has(key)) continue
			taken.add(key)
			pool.push(emoji)
		}
	const spots: (RowEmoji | null)[] = []
	for (let index = 0; index < total; index++)
		spots.push(saved[index] ?? pool.shift() ?? null)
	return spots
}

/** The emoji row inside EmojiRow's tree: its children are [emoji buttons, picker button]. */
const isEmojiRow = (node: unknown): node is Row => {
	if (!isValidElement(node)) return false
	const parts = (node as Row).props.children
	return Array.isArray(parts) && parts.length === 2 && Array.isArray(parts[0])
}

/**
 * Splits Discord's single emoji row into rows of the same style. The container holds the row
 * alone, or (React Compiler builds) the row and the "Double-tap a message" nudge.
 */
function splitRows(tree: ReactNode): ReactNode {
	const { rows } = getSettings()
	if (rows <= 1 || slots <= 1 || !isValidElement(tree)) return tree
	const container = tree as Row
	const children = container.props.children
	const list = Array.isArray(children) ? children : [children]
	const at = list.findIndex(isEmojiRow)
	if (at < 0) return tree
	const row = list[at] as Row
	const [buttons, picker] = row.props.children as [ReactNode[], ReactNode]
	if (buttons.length <= slots - 1) return tree
	// Full rows of emojis; the picker button ends the last row, after every emoji.
	const lines: ReactNode[] = []
	for (let from = 0, index = 0; from < buttons.length; from += slots, index++) {
		const chunk = buttons.slice(from, from + slots)
		const last = from + slots >= buttons.length
		lines.push(
			last
				? cloneElement(row, { key: `row-${index}` }, chunk, picker)
				: cloneElement(row, { key: `row-${index}` }, chunk),
		)
	}
	const next = [...list.slice(0, at), ...lines, ...list.slice(at + 1)]
	return cloneElement(container, {}, ...next)
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: { load: true, default: DefaultSettings },
	start({ cleanup, jsonStorage, logger }) {
		bindStorage(jsonStorage)
		cleanup(
			startStats({
				manifest,
				settings: getSettings,
			}),
			getModules(
				// modules/emojis/native/useFrequentlyUsedReactionEmojis
				withProps<FrequentEmojis>('useFrequentlyUsedReactionEmojis'),
				module => {
					frequent.hook = (guildId: unknown) =>
						module.useFrequentlyUsedReactionEmojis(guildId)
				},
			),
			getModules(
				// modules/reactions/native/useEmojisForReactionRow.tsx
				withProps<ReactionRow>('useEmojisForReactionRow'),
				row => {
					cleanup(
						instead(row, 'useEmojisForReactionRow', (args, original) => {
							const result = original(...args)
							// A hook: called on every render, whatever the settings, so the hook order stays.
							let more: RowEmoji[] = []
							try {
								more = frequent.hook?.(args[0]?.getGuildId?.()) ?? []
							} catch (error) {
								logger.error(
									'Custom Quick Reactions: frequent emojis failed:',
									error,
								)
							}
							try {
								if (!Array.isArray(result)) return result
								slots = result.length + 1
								measured.slots = slots
								return arrange(result, Array.isArray(more) ? more : [], args[0])
							} catch (error) {
								logger.error('Custom Quick Reactions failed:', error)
								return result
							}
						}),
					)
				},
			),
			getModules(
				// modules/emojis/EmojiUtils: Discord's own check for its reaction row.
				withProps<{
					isEmojiFilteredOrLocked: NonNullable<typeof emojiRules.locked>
				}>('isEmojiFilteredOrLocked'),
				utils => {
					emojiRules.locked = args => utils.isEmojiFilteredOrLocked(args)
				},
			),
			// By path: another EmojiRow exists in the server emoji settings.
			getModuleWithImportedPath(
				'modules/action_sheet/native/components/EmojiRow.tsx',
				(namespace: unknown) => {
					const host = namespace as {
						default: (...args: unknown[]) => ReactNode
					}
					if (typeof host?.default !== 'function') return
					cleanup(
						after(host, 'default', tree => {
							try {
								return splitRows(tree as ReactNode)
							} catch (error) {
								logger.error('Custom Quick Reactions: rows failed:', error)
								return tree
							}
						}),
					)
				},
			),
			getModules(
				// modules/emoji_picker/native/openEmojiPickerActionSheet.tsx, loaded the first time the picker opens
				withProps<EmojiPicker>('openEmojiPickerActionSheet'),
				picker => {
					lookups.picker = picker
				},
			),
			getModules(
				// modules/emojis/UnicodeEmojis.tsx
				withProps<UnicodeEmojis>('getByName', 'convertSurrogateToName'),
				unicode => {
					lookups.unicode = unicode
				},
			),
			() => {
				bindStorage(undefined)
				lookups.unicode = undefined
				emojiRules.locked = undefined
				lookups.picker = undefined
				frequent.hook = undefined
			},
		)
	},
	SettingsComponent,
})
