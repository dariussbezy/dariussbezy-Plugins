import { useEffect, useState } from 'react'

/** The touch options Discord was started with: changing them in the settings needs a reload to take effect. */
export const applied = {
	full: false,
	copy: false,
	pause: false,
	swipe: false,
}

export interface Recorded {
	id: number
	time: string
	text: string
	variant: string
}

const MAX_HISTORY = 30
let counter = 0
const recorded: Recorded[] = []
const watchers = new Set<() => void>()

/** Remembers a toast that opened, newest first. Kept in memory only. */
export function remember(text: string, variant: string) {
	recorded.unshift({
		id: ++counter,
		time: new Date().toTimeString().slice(0, 8),
		text,
		variant,
	})
	if (recorded.length > MAX_HISTORY) recorded.length = MAX_HISTORY
	for (const watcher of watchers) watcher()
}

export function clearHistory() {
	recorded.length = 0
	for (const watcher of watchers) watcher()
}

export function useHistory(): Recorded[] {
	const [, setTick] = useState(0)
	useEffect(() => {
		const watcher = () => setTick(tick => tick + 1)
		watchers.add(watcher)
		return () => {
			watchers.delete(watcher)
		}
	}, [])
	return recorded
}
