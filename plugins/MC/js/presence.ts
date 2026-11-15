import { Dispatcher } from '@valenced/discord/common/flux'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import type { Playback } from './music'

/**
 * The Discord application the listening status belongs to. Discord drops local activities without
 * one (stores/LocalActivityStore.tsx only keeps activities that have an `application_id`).
 */
export const APPLICATION_ID = '1571565690366861392'

/** Third-party YouTube Music clients, whose package and name do not say YouTube Music. */
const YOUTUBE_MUSIC_CLIENTS = new Set([
	'com.zionhuang.music', // InnerTune
	'com.metrolist.music', // Metrolist
	'com.dd3boh.outertune', // OuterTune
	'it.vfsfitvnm.vimusic', // ViMusic
	'app.vitune.android', // ViTune
	'com.maxrave.simpmusic', // SimpMusic
])

/**
 * The Discord status name for an app that gets a listening status; Spotify has its own. Modded
 * builds (ReVanced, RVX, Vanced and others) change the package or the name, so an app counts when
 * its package or its name mentions the app, or it is a known YouTube Music client.
 */
export function listeningApp(
	packageName: string | null | undefined,
	label?: string | null,
) {
	const pkg = packageName?.toLowerCase() ?? ''
	const name = label?.toLowerCase().replace(/\s+/g, ' ').trim() ?? ''
	if (
		pkg.includes('youtube.music') ||
		pkg.includes('youtubemusic') ||
		YOUTUBE_MUSIC_CLIENTS.has(pkg) ||
		/\b(youtube|yt) ?music\b/.test(name)
	)
		return 'YouTube Music'
	if (pkg.includes('soundcloud') || name.includes('soundcloud'))
		return 'SoundCloud'
	return undefined
}
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
/** Why the status is or is not shown right now, for Diagnostics. */
let reason = 'Not checked yet'
export const presenceReason = () => reason

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

/** App logos, used when no cover is found so Discord does not show its question mark. */
const LOGOS: Record<string, string> = {
	'YouTube Music':
		'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/YouTube_Music_2024.svg/1280px-YouTube_Music_2024.svg.png',
	SoundCloud:
		'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Antu_soundcloud.svg/1280px-Antu_soundcloud.svg.png',
}
/** Discord shows status images at up to 1024×1024, so covers are asked for in that size. */
const COVER_SIZE = 1024

const simplify = (text: string) =>
	text
		.toLowerCase()
		.replace(/\(.*?\)|\[.*?\]/g, '')
		.replace(/[^0-9a-zÀ-￿]+/g, ' ')
		.trim()

/** The player's own cover link, in the largest size its host offers. */
function largerUrl(url: string) {
	return (
		url
			// SoundCloud: -large (100 px) or -t300x300 → -t500x500, its largest fixed size.
			.replace(/-(large|t\d+x\d+|crop|small|tiny)\.(jpg|png)/, '-t500x500.$2')
			// Google images (YouTube Music): =w120-h120… → 1024 px.
			.replace(/=w\d+-h\d+/, `=w${COVER_SIZE}-h${COVER_SIZE}`)
	)
}

async function json<T>(url: string): Promise<T | null> {
	const response = await fetch(url)
	return response.ok ? ((await response.json()) as T) : null
}

/** Deezer's public search: covers up to 1000 px and many songs Apple does not have. */
async function deezerCover(artist: string, title: string) {
	type Result = {
		data?: {
			title?: string
			artist?: { name?: string }
			album?: { cover_xl?: string }
		}[]
	}
	const exact = await json<Result>(
		`https://api.deezer.com/search?limit=5&q=${encodeURIComponent(`artist:"${artist}" track:"${title}"`)}`,
	)
	const loose = exact?.data?.length
		? exact
		: await json<Result>(
				`https://api.deezer.com/search?limit=5&q=${encodeURIComponent(`${artist} ${title}`)}`,
			)
	const results = loose?.data ?? []
	const wanted = simplify(artist)
	const match =
		results.find(r => {
			const name = simplify(r.artist?.name ?? '')
			return name && wanted && (name.includes(wanted) || wanted.includes(name))
		}) ?? results[0]
	const cover = match?.album?.cover_xl
	return cover
		? cover.replace(/\/\d+x\d+-/, `/${COVER_SIZE}x${COVER_SIZE}-`)
		: null
}

async function itunesCover(artist: string, title: string) {
	const data = await json<{ results?: { artworkUrl100?: string }[] }>(
		`https://itunes.apple.com/search?entity=song&limit=1&term=${encodeURIComponent(`${artist} ${title}`.trim())}`,
	)
	const small = data?.results?.[0]?.artworkUrl100
	return small
		? small.replace(/\/\d+x\d+bb\./, `/${COVER_SIZE}x${COVER_SIZE}bb.`)
		: null
}

/**
 * Web addresses to try for the status image, best first: the player's own link (SoundCloud
 * gives one; YouTube Music only hands over the image), then the song looked up by title and
 * artist on Deezer and on Apple's iTunes, then the app's logo.
 */
async function coverUrlsOf(playback: Playback): Promise<string[]> {
	const urls: string[] = []
	if (playback.artworkUrl) urls.push(largerUrl(playback.artworkUrl))
	const artist = playback.artist.replace(/ - Topic$/, '').trim()
	const title = playback.title.trim()
	if (!playback.artworkUrl && title) {
		for (const find of [deezerCover, itunesCover]) {
			try {
				const url = await find(artist, title)
				if (url) {
					urls.push(url)
					break
				}
			} catch {
				// Try the next source.
			}
		}
	}
	const logo = LOGOS[listeningApp(playback.packageName, playback.app) ?? '']
	if (logo) urls.push(logo)
	return urls
}

interface Http {
	post(request: {
		url: string
		body: unknown
	}): Promise<{ body?: { external_asset_path?: string }[] }>
}

/**
 * Asks Discord to turn the link into a status image (`mp:external/…`), through Discord's own REST
 * client and login. Discord's asset helper module is only loaded once Discord shows a status image
 * itself, so it is not found on most phones; the request it makes is sent directly instead.
 */
async function assetOf(url: string): Promise<string | null> {
	const [module] = lookupModule(withProps<{ HTTP: Http }>('HTTP'))
	if (module?.HTTP)
		try {
			const response = await module.HTTP.post({
				url: `/applications/${APPLICATION_ID}/external-assets`,
				body: { urls: [url] },
			})
			const path = response.body?.[0]?.external_asset_path
			if (typeof path === 'string' && path) return `mp:${path}`
		} catch {
			// Try Discord's helper below.
		}
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
			for (const url of await coverUrlsOf(playback)) {
				cover = await assetOf(url).catch(() => null)
				if (cover) break
			}
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

	const name = listeningApp(playback?.packageName, playback?.app)
	reason = !presenceReady()
		? 'Not available'
		: !enabled
			? 'Off. Turn on Listening status above.'
			: !playback
				? 'Waiting: nothing is playing.'
				: playback.source !== 'bridge'
					? 'Waiting: Spotify shows its own status.'
					: !name
						? `Not shown for ${playback.app ?? 'this app'} (${playback.packageName ?? 'unknown app'}). Only YouTube Music and SoundCloud get a listening status.`
						: !playback.playing
							? 'Waiting: playback is paused.'
							: `Sent as Listening to ${name}. If friends do not see it, check Settings > Content & Social > Activity Status and that you are not Invisible.`
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
