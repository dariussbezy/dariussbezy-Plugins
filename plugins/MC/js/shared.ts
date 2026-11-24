import type { JsonStorage } from '@valenced/json-storage'

export type TransparencyLevel = 'low' | 'medium' | 'high'
export const TransparencyLevels: TransparencyLevel[] = ['low', 'medium', 'high']

export interface Settings {
	compact: boolean
	closed: boolean
	alwaysShow: boolean
	animatedWave: boolean
	/** Transparent card, buttons and progress. */
	transparent: boolean
	/** How see-through the transparent look is. */
	transparency: TransparencyLevel
	/** Frosted: blurred, whitish glass. Off: clear glass that only tints what is behind it. */
	frosted: boolean
	/** Show "Listening to YouTube Music / SoundCloud" on the Discord profile. */
	listeningStatus: boolean
	expandedShuffle: boolean
	expandedPrevious: boolean
	expandedPlay: boolean
	expandedNext: boolean
	expandedRepeat: boolean
	expandedSearch: boolean
	compactShuffle: boolean
	compactPrevious: boolean
	compactPlay: boolean
	compactNext: boolean
	compactRepeat: boolean
	compactSearch: boolean
}

export const DefaultSettings: Settings = {
	compact: false,
	closed: false,
	alwaysShow: false,
	animatedWave: true,
	transparent: true,
	transparency: 'medium',
	frosted: false,
	listeningStatus: false,
	expandedShuffle: true,
	expandedPrevious: true,
	expandedPlay: true,
	expandedNext: true,
	expandedRepeat: true,
	expandedSearch: true,
	compactShuffle: false,
	compactPrevious: true,
	compactPlay: true,
	compactNext: true,
	compactRepeat: false,
	compactSearch: false,
}

export type ButtonId =
	| 'Shuffle'
	| 'Previous'
	| 'Play'
	| 'Next'
	| 'Repeat'
	| 'Search'

export const ButtonIds: ButtonId[] = [
	'Shuffle',
	'Previous',
	'Play',
	'Next',
	'Repeat',
	'Search',
]

export type PlayerMode = 'expanded' | 'compact'
export type DockMode = 'closed' | 'collapsed' | 'expanded'

export const dockModeOf = (settings: Settings): DockMode =>
	settings.closed ? 'closed' : settings.compact ? 'collapsed' : 'expanded'

let storage: JsonStorage<Settings> | undefined

export function setStorage(next: JsonStorage<Settings> | undefined) {
	storage = next
}

/** Keeps only known boolean keys, so a corrupted storage file cannot break the player. */
function normalize(raw: Record<string, unknown> | undefined): Settings {
	const settings = { ...DefaultSettings }
	if (!raw) return settings
	for (const key of Object.keys(DefaultSettings) as (keyof Settings)[]) {
		const value = raw[key]
		if (typeof settings[key] === 'boolean' && typeof value === 'boolean')
			(settings as Record<string, unknown>)[key] = value
	}
	// "Transparent" was called "Liquid glass" before 1.4.0: keep the choice users made.
	if (
		typeof raw.transparent !== 'boolean' &&
		typeof raw.liquidGlass === 'boolean'
	)
		settings.transparent = raw.liquidGlass
	if (TransparencyLevels.includes(raw.transparency as TransparencyLevel))
		settings.transparency = raw.transparency as TransparencyLevel
	// Migrate the beta flag that was replaced by `animatedWave`
	if (raw.waveShape === false && typeof raw.animatedWave !== 'boolean')
		settings.animatedWave = false
	return settings
}

/** Current settings outside React. */
export const getSettings = (): Settings =>
	normalize(storage?.cache as Record<string, unknown> | undefined)

/** React hook: current settings, re-renders when they change. */
export function useSettings(): Settings {
	return normalize(storage?.use() as Record<string, unknown> | undefined)
}

export function setSetting<K extends keyof Settings>(
	key: K,
	value: Settings[K],
) {
	storage?.set({ [key]: value }).catch(() => {})
}

export function setDockMode(mode: DockMode) {
	storage
		?.set({ closed: mode === 'closed', compact: mode !== 'expanded' })
		.catch(() => {})
}

/** Discord's design API only exists after init, so styles are created on first use rather than at import. */
export function lazyStyles<T>(create: () => () => T) {
	let hook: (() => T) | undefined
	return () => (hook ??= create())()
}
