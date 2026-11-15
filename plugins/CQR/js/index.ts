import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
import SettingsComponent from './settings'
import {
	bindStorage,
	DefaultSettings,
	getSettings,
	keyOf,
	lookups,
	resolve,
} from './shared'
import type { RowEmoji, Settings, UnicodeEmojis } from './shared'

type ReactionRow = {
	useEmojisForReactionRow: (...args: unknown[]) => (RowEmoji | null)[]
}

/** Puts the chosen emojis first, keeping as many spots as Discord fits on the screen. */
function customize(result: (RowEmoji | null)[]) {
	const { emojis, fill } = getSettings()
	if (!Array.isArray(result) || !emojis.length) return result
	const chosen = emojis.map(resolve)
	const keys = new Set(chosen.map(keyOf))
	const rest = fill
		? result.filter(
				(emoji): emoji is RowEmoji => emoji != null && !keys.has(keyOf(emoji)),
			)
		: []
	const next: (RowEmoji | null)[] = [...chosen, ...rest].slice(0, result.length)
	while (next.length < result.length) next.push(null)
	return next
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: { load: true, default: DefaultSettings },
	start({ cleanup, jsonStorage, logger }) {
		bindStorage(jsonStorage)
		cleanup(
			getModules(
				// modules/reactions/native/useEmojisForReactionRow.tsx
				withProps<ReactionRow>('useEmojisForReactionRow'),
				row => {
					cleanup(
						after(row, 'useEmojisForReactionRow', result => {
							try {
								return customize(result)
							} catch (error) {
								logger.error('Custom Quick Reactions failed:', error)
								return result
							}
						}),
					)
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
			},
		)
	},
	SettingsComponent,
})
