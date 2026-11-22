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
	/**
	 * Emojis by spot in the quick reactions, row after row. An empty spot (null) shows a frequent
	 * emoji, or nothing when filling is off.
	 */
	emojis: (SavedEmoji | null)[]
	/** Fill the spots left over with Discord's frequent emojis. */
	fill: boolean
	/** Rows of quick reactions in the long-press menu (1 to 3). */
	rows: number
}

export const DefaultSettings: Settings = { emojis: [], fill: true, rows: 1 }

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

export const lookups: { unicode?: UnicodeEmojis; picker?: EmojiPicker } = {}

/** Spots in one quick reaction row on this screen, from the last time Discord built it. */
export const measured = { slots: 0 }

let storage: JsonStorage<Settings> | undefined

export function bindStorage(value: JsonStorage<Settings> | undefined) {
	storage = value
}

/** Valid spots only, without empty spots at the end. */
export function cleanSpots(spots: unknown): (SavedEmoji | null)[] {
	const list = Array.isArray(spots)
		? spots.map(spot =>
				spot &&
				typeof spot === 'object' &&
				typeof (spot as SavedEmoji).name === 'string'
					? (spot as SavedEmoji)
					: null,
			)
		: []
	while (list.length && list[list.length - 1] == null) list.pop()
	return list
}

export const getSettings = (): Settings => {
	const settings = { ...DefaultSettings, ...storage?.cache }
	settings.emojis = cleanSpots(settings.emojis)
	const rows = Math.round(Number(settings.rows))
	settings.rows = rows >= 1 && rows <= 3 ? rows : 1
	return settings
}

// Arrays would be merged item by item, so the whole object is always replaced.
export const setSettings = (patch: Partial<Settings>) => {
	const next = { ...getSettings(), ...patch }
	next.emojis = cleanSpots(next.emojis)
	void storage?.set(next, true)
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
