import { Dispatcher } from '@valenced/discord/common/flux'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import type { Playback } from './music'

/**
 * The Discord application the listening status belongs to. Discord drops local activities without
 * one (stores/LocalActivityStore.tsx only keeps activities that have an `application_id`).
 */
export const APPLICATION_ID = '1571565690366861392'

/** The Discord status name for each app that gets a listening status. Spotify has its own. */
const APPS: Record<string, string> = {
	'com.google.android.apps.youtube.music': 'YouTube Music',
	'com.soundcloud.android': 'SoundCloud',
}
const YOUTUBE_MUSIC = 'com.google.android.apps.youtube.music'
const SOCKET_ID = 'dariuss.music-controls'
/** A seek moves the start time; smaller drifts come from polling and are ignored. */
const DRIFT_MS = 3000
/**
 * Each change is a presence update on Discord's own connection, so changes are sent at most once
 * every 15 seconds; changes in between are merged and only the newest is sent.
 */
const MIN_GAP_MS = 15_000
/** How long a new song waits for its cover before the status is sent without one. */
const COVER_WAIT_MS = 4000
/** Discord's "Listening to" activity type. */
const LISTENING = 2
const CACHE_LIMIT = 100

type Activity = Record<string, unknown>

/** utils/ApplicationAssetUtils.tsx: turns web image links into status images (`mp:external/…`). */
interface AssetUtils {
	fetchAssetIds(applicationId: string, urls: string[]): Promise<unknown>
	getAssetIds(applicationId: string, urls: string[]): (string | null)[]
}

let shown: {
	id: string
	start: number
	name: string
	cover: string | null
} | null = null
let lastSentAt = 0
let pending: { activity: Activity | null } | null = null
let timer: ReturnType<typeof setTimeout> | undefined

/** Status image per song id; null when there is none. */
const covers = new Map<string, string | null>()
/** Songs whose cover is being looked up, with when it started. */
const lookups = new Map<string, number>()
/** The last call, to run again once a cover arrives. */
let lastCall: [Playback | null, boolean, number] | null = null

export const presenceReady = () => APPLICATION_ID.length > 0

function remember(id: string, cover: string | null) {
	if (covers.size >= CACHE_LIMIT) covers.clear()
	covers.set(id, cover)
}

function dispatch(activity: Activity | null) {
	lastSentAt = Date.now()
	void Dispatcher.dispatch({
		type: 'LOCAL_ACTIVITY_UPDATE',
		socketId: SOCKET_ID,
		pid: 0,
		activity,
	} as Parameters<typeof Dispatcher.dispatch>[0])
}

function send(activity: Activity | null, now = false) {
	if (timer) clearTimeout(timer)
	timer = undefined
	const wait = lastSentAt + MIN_GAP_MS - Date.now()
	if (now || wait <= 0) {
		pending = null
		dispatch(activity)
		return
	}
	pending = { activity }
	timer = setTimeout(() => {
		timer = undefined
		if (pending) dispatch(pending.activity)
		pending = null
	}, wait)
}

/**
 * A web address for the cover. SoundCloud gives one; YouTube Music only hands over the image, so
 * its cover is looked up by title and artist in Apple's public iTunes search.
 */
async function coverUrlOf(playback: Playback): Promise<string | null> {
	if (playback.artworkUrl) return playback.artworkUrl
	if (playback.packageName !== YOUTUBE_MUSIC) return null
	const artist = playback.artist.replace(/ - Topic$/, '')
	const term = encodeURIComponent(`${artist} ${playback.title}`.trim())
	const response = await fetch(
		`https://itunes.apple.com/search?term=${term}&entity=song&limit=1`,
	)
	if (!response.ok) return null
	const data = (await response.json()) as {
		results?: { artworkUrl100?: string }[]
	}
	const small = data.results?.[0]?.artworkUrl100
	return small ? small.replace(/\/\d+x\d+bb\./, '/512x512bb.') : null
}

/** Asks Discord to turn the link into a status image, with Discord's own helper and login. */
async function assetOf(url: string): Promise<string | null> {
	const [utils] = lookupModule(
		withProps<AssetUtils>('fetchAssetIds', 'getAssetIds'),
	)
	if (!utils) return null
	const result = await utils.fetchAssetIds(APPLICATION_ID, [url])
	const ids = Array.isArray(result)
		? (result as (string | null)[])
		: utils.getAssetIds(APPLICATION_ID, [url])
	const id = ids?.[0]
	return typeof id === 'string' && id.startsWith('mp:') ? id : null
}

function lookUpCover(playback: Playback) {
	if (lookups.has(playback.id)) return
	lookups.set(playback.id, Date.now())
	void (async () => {
		let cover: string | null = null
		try {
			const url = await coverUrlOf(playback)
			if (url) cover = await assetOf(url)
		} catch {
			// No cover then; the status is still shown.
		}
		remember(playback.id, cover)
		lookups.delete(playback.id)
		if (lastCall) updatePresence(...lastCall)
	})()
}

/**
 * Shows "Listening to YouTube Music / SoundCloud" with the song, its cover and time bar while it
 * plays, and clears it otherwise. Only sends again when something visible really changed.
 */
export function updatePresence(
	playback: Playback | null,
	enabled: boolean,
	position: number,
) {
	lastCall = [playback, enabled, position]
	// Background timers can be delayed, so a held-back change is also sent on the next update.
	if (pending && Date.now() - lastSentAt >= MIN_GAP_MS) send(pending.activity)

	const name = playback?.packageName ? APPS[playback.packageName] : undefined
	if (
		!presenceReady() ||
		!enabled ||
		!playback ||
		playback.source !== 'bridge' ||
		!playback.playing ||
		!name
	) {
		if (shown) {
			shown = null
			send(null)
		}
		return
	}

	if (!covers.has(playback.id)) {
		lookUpCover(playback)
		// Give a new song a moment to get its cover, so it is not sent twice.
		const startedAt = lookups.get(playback.id)
		if (startedAt && Date.now() - startedAt < COVER_WAIT_MS) return
	}
	const cover = covers.get(playback.id) ?? null

	const start = Date.now() - position
	if (
		shown &&
		shown.id === playback.id &&
		shown.name === name &&
		shown.cover === cover &&
		Math.abs(shown.start - start) < DRIFT_MS
	)
		return
	shown = { id: playback.id, start, name, cover }
	send({
		application_id: APPLICATION_ID,
		name,
		type: LISTENING,
		details: playback.title,
		state: playback.artist || undefined,
		timestamps:
			playback.duration > 0
				? { start, end: start + playback.duration }
				: { start },
		...(cover
			? {
					// Discord shows the image text as the album line, so it is the album or nothing.
					assets: {
						large_image: cover,
						...(albumLine(playback) ? { large_text: albumLine(playback) } : {}),
					},
				}
			: {}),
		flags: 0,
	})
}

/** The album, unless it only repeats the title (singles on YouTube Music are their own album). */
function albumLine(playback: Playback) {
	const album = playback.album?.trim()
	if (!album) return null
	const same = (a: string, b: string) =>
		a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0
	return same(album, playback.title.trim()) ||
		same(album.replace(/ - (Single|EP)$/i, ''), playback.title.trim())
		? null
		: album
}

/** Clears the status at once, for when the plugin stops. */
export function clearPresence() {
	shown = null
	lastCall = null
	if (timer) clearTimeout(timer)
	timer = undefined
	pending = null
	send(null, true)
}
