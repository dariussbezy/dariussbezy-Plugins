import type { JsonStorage } from '@valenced/json-storage'

/** Transparency level. High is the most see-through. Same names and order as Music Controls. */
export type Level = 'low' | 'medium' | 'high'

export const Levels: Level[] = ['low', 'medium', 'high']

export interface Settings {
	enabled: boolean
	level: Level
}

export const DefaultSettings: Settings = {
	enabled: true,
	level: 'medium',
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
