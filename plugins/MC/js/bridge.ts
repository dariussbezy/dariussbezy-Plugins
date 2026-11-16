import type { TransparencyLevel } from './shared'

/**
 * Shared with the Transparent YOUBAR plugin: it learns here whether the player card sits above the
 * YouBar and which transparency level is on, so the two join into one seamless surface.
 */
interface Bridge {
	mc?: { visible: boolean; level: TransparencyLevel }
	listeners: Set<() => void>
}

const KEY = '__valencedTransparent'

function bridge(): Bridge {
	const scope = globalThis as unknown as Record<string, Bridge | undefined>
	const existing = scope[KEY]
	if (existing && existing.listeners instanceof Set) return existing
	return (scope[KEY] = { ...existing, listeners: new Set() })
}

function notify(shared: Bridge) {
	for (const listener of [...shared.listeners]) {
		try {
			listener()
		} catch {}
	}
}

export function setBridge(visible: boolean, level: TransparencyLevel) {
	try {
		const shared = bridge()
		if (shared.mc?.visible === visible && shared.mc.level === level) return
		shared.mc = { visible, level }
		notify(shared)
	} catch {}
}

export function clearBridge() {
	try {
		const shared = bridge()
		if (!shared.mc) return
		shared.mc = undefined
		notify(shared)
	} catch {}
}
