import { Stores } from '@valenced/discord/flux'
import { getBridgeInfo } from '@valenced/modules/native'
import {
	existsSync,
	getConstants,
	readFileSync,
	writeFileSync,
} from '@valenced/modules/native/fs'
import { AppState, Platform, TurboModuleRegistry } from 'react-native'

/**
 * Usage statistics for dariussbezy's plugins, as stated in the repository's terms and in each
 * README: who uses which version on which device, and the plugin's simple options.
 * Never the token, messages, API keys or any text typed into a setting.
 */
const Endpoint = 'https://plugin-stats.dariussfun.workers.dev/report'
const FirstDelay = 20_000
const Interval = 60 * 60 * 1000
/** How often a running plugin checks whether an hour has passed. */
const CheckEvery = 10 * 60 * 1000
/** Settings whose name hints at anything private are never sent. */
const Private =
	/key|token|secret|pass|auth|cookie|webhook|url|prompt|text|note/i

type Manifest = { id: string; version: string }
type CurrentUser = {
	id?: string
	username?: string
	globalName?: string | null
}

/** Only switches, numbers and short choices (like "highlight" or "#ED4245"). */
function simpleSettings(settings: unknown) {
	const out: Record<string, boolean | number | string> = {}
	if (!settings || typeof settings !== 'object') return out
	for (const [key, value] of Object.entries(settings)) {
		if (Private.test(key)) continue
		if (typeof value === 'boolean') out[key] = value
		else if (typeof value === 'number' && Number.isFinite(value))
			out[key] = value
		else if (
			typeof value === 'string' &&
			value.length <= 24 &&
			// No ids: a lone snowflake could point at a person or a server.
			!/^\d{5,}$/.test(value) &&
			/^[\w#.-]*$/.test(value)
		)
			out[key] = value
	}
	return out
}

function discordVersion() {
	try {
		const info = TurboModuleRegistry.get<{
			getConstants(): { Version?: string; Build?: string }
		}>('NativeClientInfoModule' as never)?.getConstants()
		return info?.Version
			? `${info.Version}${info.Build ? ` (${info.Build})` : ''}`
			: undefined
	} catch {
		return undefined
	}
}

function valencedVersion() {
	try {
		const info = getBridgeInfo()
		return info ? `${info.name} ${info.version}` : undefined
	} catch {
		return undefined
	}
}

/** When each plugin last reported, in a file so a restart does not send again. */
function lastSentFile() {
	const { cache } = getConstants()
	return `${cache.replace(/\/$/, '')}/dariuss-plugin-stats.json`
}

function readSent(): Record<string, number> {
	try {
		const path = lastSentFile()
		const sent = existsSync(path) ? JSON.parse(readFileSync(path)) : {}
		return sent && typeof sent === 'object' ? sent : {}
	} catch {
		return {}
	}
}

/** Also kept in memory, so a device where the file cannot be written still waits an hour. */
const sentThisRun = new Map<string, number>()

const lastSent = (id: string) =>
	Math.max(Number(readSent()[id]) || 0, sentThisRun.get(id) ?? 0)

function markSent(id: string) {
	sentThisRun.set(id, Date.now())
	try {
		// Read again right before writing: plugins share the file and JS runs one at a time.
		writeFileSync(
			lastSentFile(),
			JSON.stringify({ ...readSent(), [id]: Date.now() }),
		)
	} catch {
		// The in-memory time still applies until Discord restarts.
	}
}

export type StatsSource = { manifest: Manifest; settings(): unknown }

/** Sends one report now. Resolves to whether the server accepted it. */
export async function sendStats({ manifest, settings }: StatsSource) {
	try {
		const user = (
			Stores.UserStore as unknown as
				| { getCurrentUser(): CurrentUser | undefined }
				| undefined
		)?.getCurrentUser()
		if (!user?.id) return false
		const response = await fetch(Endpoint, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				plugin: manifest.id,
				pluginVersion: manifest.version,
				userId: user.id,
				username: user.globalName
					? `${user.globalName} (@${user.username})`
					: user.username,
				platform: Platform.OS,
				osVersion: String(Platform.Version),
				discordVersion: discordVersion(),
				valencedVersion: valencedVersion(),
				settings: simpleSettings(settings()),
			}),
		})
		if (response.ok) markSent(manifest.id)
		return response.ok
	} catch {
		return false
	}
}

/**
 * Sends a report at most once an hour per plugin, only while Discord is open: 20 seconds after
 * start, when the app comes back to the foreground, and on a check every 10 minutes. The send time
 * is saved on the device, so restarting Discord within the hour does not send again. Returns the
 * function that stops it.
 */
export function startStats(source: StatsSource) {
	let timer: ReturnType<typeof setTimeout> | undefined
	let stopped = false
	let sending = false
	const check = async () => {
		if (stopped || sending) return
		if (Date.now() - lastSent(source.manifest.id) < Interval) return
		sending = true
		try {
			await sendStats(source)
		} finally {
			sending = false
		}
	}
	const loop = () => {
		if (stopped) return
		timer = setTimeout(loop, CheckEvery)
		void check()
	}
	let appState: { remove(): void } | undefined
	try {
		timer = setTimeout(loop, FirstDelay)
		appState = AppState.addEventListener('change', state => {
			if (state === 'active') void check()
		})
	} catch {
		// Statistics never get in the way of the plugin.
	}
	return () => {
		stopped = true
		try {
			if (timer) clearTimeout(timer)
			appState?.remove()
		} catch {}
	}
}
