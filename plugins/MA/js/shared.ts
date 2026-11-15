import type { JsonStorage } from '@valenced/json-storage'

export interface Settings {
	/** Every action label seen so far, in the order the user wants, with section breaks between. */
	order: string[]
	/** Labels of the actions that are not shown. */
	hidden: string[]
	/** Labels of the actions removed from the menu and the list. */
	removed: string[]
	/** False until the user changes something, so Discord's own layout is kept until then. */
	customized: boolean
	/** Hide the quick reactions above the buttons. */
	hideReactions: boolean
	/** Icon asset of each button, by label, so the settings can show it after a restart. */
	icons: Record<string, { name?: string; id?: number }>
}

export const DefaultSettings: Settings = {
	order: [],
	hidden: [],
	removed: [],
	customized: false,
	hideReactions: false,
	icons: {},
}

/** Icon components seen in this session, by label. */
export const sessionIcons = new Map<string, unknown>()

/** Section breaks are stored in the order as tokens no button label can have. */
const SECTION = '\u0000section:'
export const isSection = (token: string) => token.startsWith(SECTION)
export const newSection = () =>
	SECTION + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

let storage: JsonStorage<Settings> | undefined

export function bindStorage(value: JsonStorage<Settings> | undefined) {
	storage = value
}

export const getSettings = (): Settings => ({
	...DefaultSettings,
	...storage?.cache,
})

// Arrays would be merged item by item, so the whole object is always replaced.
export const setSettings = (patch: Partial<Settings>) => {
	void storage?.set({ ...getSettings(), ...patch }, true)
}

let version = 0
/** Changes whenever the settings do, for useSyncExternalStore. */
export const snapshot = () => version

export const subscribe = (listener: () => void) =>
	storage?.subscribe(() => {
		version++
		listener()
	}) ?? (() => {})

/**
 * Adds buttons that were not seen before. The first time, Discord's sections become section breaks;
 * later, a new button goes right after the button that precedes it in the sheet.
 */
export function learn(order: readonly string[], groups: readonly string[][]) {
	if (!order.length)
		return groups
			.filter(group => group.length)
			.flatMap((group, index) => (index ? [newSection(), ...group] : group))
	const seen = groups.flat()
	const next = [...order]
	let changed = false
	seen.forEach((label, index) => {
		if (next.includes(label)) return
		const previous = seen
			.slice(0, index)
			.reverse()
			.find(other => next.includes(other))
		next.splice(previous ? next.indexOf(previous) + 1 : 0, 0, label)
		changed = true
	})
	// Lists saved before section breaks existed get one before each of Discord's sections.
	if (!next.some(isSection))
		for (const group of groups.slice(1)) {
			const at = group.length ? next.indexOf(group[0]) : -1
			if (at > 0 && !isSection(next[at - 1])) {
				next.splice(at, 0, newSection())
				changed = true
			}
		}
	return changed ? next : null
}
