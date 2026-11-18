import type { JsonStorage } from '@valenced/json-storage'

/** Transparency level. High is the most see-through. Same names and order as Music Controls. */
export type Level = 'low' | 'medium' | 'high'

export const Levels: Level[] = ['low', 'medium', 'high']

export interface Settings {
	enabled: boolean
	level: Level
	/** Hides the nameplate Discord draws in the bar (its local nameplate setting). */
	hideNameplate: boolean
	/** Hides the dark shade Discord adds under the bar. */
	hideShade: boolean
}

export const DefaultSettings: Settings = {
	enabled: true,
	level: 'medium',
	hideNameplate: true,
	hideShade: true,
}

let storage: JsonStorage<Settings> | undefined

export function setStorage(next: JsonStorage<Settings> | undefined) {
	storage = next
}

/** Keeps only known keys with the right type, so a corrupted storage file cannot break the bar. */
function normalize(raw: Record<string, unknown> | undefined): Settings {
	const settings = { ...DefaultSettings }
	if (!raw) return settings
	if (typeof raw.enabled === 'boolean') settings.enabled = raw.enabled
	if (Levels.includes(raw.level as Level)) settings.level = raw.level as Level
	if (typeof raw.hideNameplate === 'boolean')
		settings.hideNameplate = raw.hideNameplate
	if (typeof raw.hideShade === 'boolean') settings.hideShade = raw.hideShade
	return settings
}

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
