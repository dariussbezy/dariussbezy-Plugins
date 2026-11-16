import { useSyncExternalStore } from 'react'
import type { Level } from './shared'

/**
 * Bridge shared with Music Controls (it creates the object when missing, so does this plugin):
 * `mc.visible` is true while its player card is on screen above the YouBar, `mc.level` is the
 * transparency level the card uses, and `listeners` are called after every change.
 */
interface Bridge {
	mc?: { visible: boolean; level: Level }
	listeners: Set<() => void>
}

const KEY = '__valencedTransparent'

function bridge(): Bridge | undefined {
	try {
		const root = globalThis as unknown as Record<string, Bridge | undefined>
		const found = root[KEY]
		if (found && typeof found === 'object') {
			if (!(found.listeners instanceof Set)) found.listeners = new Set()
			return found
		}
		return (root[KEY] = { listeners: new Set() })
	} catch {
		return undefined
	}
}

export interface McState {
	visible: boolean
	level: Level
}

const isLevel = (value: unknown): value is Level =>
	value === 'low' || value === 'medium' || value === 'high'

/** Music Controls state, or null while its player is not shown (or the plugin is missing). */
export function mcState(): McState | null {
	try {
		const mc = bridge()?.mc
		if (mc?.visible === true && isLevel(mc.level))
			return { visible: true, level: mc.level }
	} catch {}
	return null
}

function subscribe(listener: () => void) {
	const listeners = bridge()?.listeners
	listeners?.add(listener)
	return () => {
		listeners?.delete(listener)
	}
}

/** Re-renders when Music Controls shows, hides or changes its level; null while it is not shown. */
export function useMc(): McState | null {
	const key = useSyncExternalStore(subscribe, () => {
		const state = mcState()
		return state ? state.level : ''
	})
	return key ? { visible: true, level: key as Level } : null
}
