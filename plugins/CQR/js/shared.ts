import { Stores } from '@valenced/discord/flux'
import type { JsonStorage } from '@valenced/json-storage'

/** An emoji as it is saved: custom emojis by id, Unicode emojis by name and characters. */
export interface SavedEmoji {
	id?: string
	name: string
	surrogates?: string
	animated?: boolean
}

export interface Settings {
	/** Emojis shown first in the quick reactions, in this order. */
	emojis: SavedEmoji[]
	/** Fill the spots left over with Discord's frequent emojis. */
	fill: boolean
}

export const DefaultSettings: Settings = { emojis: [], fill: true }

/** The emoji shape Discord's reaction row and pickers use. */
export interface RowEmoji {
	type?: number
	id?: string | null
	name?: string
	uniqueName?: string
	surrogates?: string
	optionallyDiverseSequence?: string
	animated?: boolean
}

export interface UnicodeEmojis {
	getByName(name: string): RowEmoji | null
	convertSurrogateToName(surrogates: string): string
}

export interface EmojiPicker {
	openEmojiPickerActionSheet(
		options: Record<string, unknown>,
		stack?: string,
	): void
}

interface EmojiStore {
	getCustomEmojiById(id: string): RowEmoji | null | undefined
}

const UNICODE = 0
const GUILD = 1

export const lookups: { unicode?: UnicodeEmojis } = {}

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

/** Same key for the same emoji, saved or from Discord. */
export const keyOf = (emoji: RowEmoji | SavedEmoji) =>
	emoji.id ??
	('optionallyDiverseSequence' in emoji && emoji.optionallyDiverseSequence
		? emoji.optionallyDiverseSequence
		: emoji.surrogates) ??
	emoji.name

export function toSaved(emoji: RowEmoji): SavedEmoji | null {
	if (emoji.id && emoji.name)
		return { id: emoji.id, name: emoji.name, animated: !!emoji.animated }
	const surrogates = emoji.optionallyDiverseSequence ?? emoji.surrogates
	const name = emoji.uniqueName ?? emoji.name
	return surrogates && name ? { name, surrogates } : null
}

/** Turns a saved emoji back into the object Discord's reaction row renders and reacts with. */
export function resolve(saved: SavedEmoji): RowEmoji {
	if (saved.id) {
		const store = Stores.EmojiStore as unknown as EmojiStore | undefined
		return (
			store?.getCustomEmojiById(saved.id) ?? {
				type: GUILD,
				id: saved.id,
				name: saved.name,
				animated: !!saved.animated,
			}
		)
	}
	const known = lookups.unicode?.getByName(saved.name)
	if (known && keyOf(known) === saved.surrogates) return known
	return {
		type: UNICODE,
		name: saved.name,
		uniqueName: saved.name,
		surrogates: saved.surrogates,
		optionallyDiverseSequence: saved.surrogates,
	}
}
