import type { JsonStorage } from '@valenced/json-storage'

export interface Settings {
	hideWhenEmpty: boolean
	showBadge: boolean
	includeDMs: boolean
	keepUnvisitedPings: boolean
}

export const DefaultSettings: Settings = {
	hideWhenEmpty: true,
	showBadge: true,
	includeDMs: false,
	keepUnvisitedPings: false,
}

/** Re-render callbacks of the profile bar button and the open ping sheet. */
export const listeners = new Set<() => void>()

let storage: JsonStorage<Settings> | undefined

export function bindStorage(value: JsonStorage<Settings> | undefined) {
	storage = value
}

export const getSettings = (): Settings => ({
	...DefaultSettings,
	...storage?.cache,
})

let timer: ReturnType<typeof setTimeout> | undefined

/** Coalesces bursts of store changes into one UI refresh. */
export function notify() {
	if (timer) return
	timer = setTimeout(() => {
		timer = undefined
		for (const listener of listeners) listener()
	}, 80)
}

export function cancelNotify() {
	if (timer) clearTimeout(timer)
	timer = undefined
}
