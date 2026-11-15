import { useSyncExternalStore } from 'react'
import { AppState, Linking } from 'react-native'
import {
	androidBridge,
	bridgeArt,
	bridgeState,
	command,
	isPlaying,
	press,
} from './native'
import {
	getState as getSpotify,
	refresh as refreshSpotify,
	control as spotifyControl,
	startSpotify,
	subscribe as subscribeSpotify,
} from './spotify'
import type { BridgeState } from './native'
import type { Playback as SpotifyPlayback } from './spotify'

export type Repeat = 'off' | 'track' | 'context'
export type ControlAction =
	| 'play'
	| 'pause'
	| 'next'
	| 'previous'
	| 'seek'
	| 'shuffle'
	| 'repeat'

/** Where the song comes from: Discord's Spotify connection, Music Bridge, or media keys only. */
export type Source = 'spotify' | 'bridge' | 'keys'

export interface Playback {
	/** Changes with the song, for resets keyed on it. */
	id: string
	title: string
	artist: string
	artwork: string | null
	duration: number
	position: number
	updatedAt: number
	playing: boolean
	shuffle: boolean
	repeat: Repeat
	canShuffle: boolean
	canRepeat: boolean
	/** Name and package of the app that plays. */
	app: string | null
	packageName: string | null
	source: Source
}

export interface MusicState {
	playback: Playback | null
	/** Short summary for the preview and the diagnostics. */
	status: string
	spotifyStatus: string
	bridgeStatus: string
	spotifyConnected: boolean
	bridgeConnected: boolean
	/** A Spotify request is running. */
	busy: boolean
	/** The player was swiped away for this music session. */
	dismissed: boolean
}

const SPOTIFY_PACKAGE = 'com.spotify.music'
/** SoundCloud keeps shuffle and repeat to itself, so their buttons are hidden for it. */
const NO_MODES = new Set(['com.soundcloud.android'])
const POLL_MS = 1000
const IDLE_HIDE_MS = 5 * 60 * 1000
/** Keeps an optimistic change visible until the player reports it, or this long. */
const OPTIMISTIC_MS = 2500
const REPEATS: Record<string, Repeat> = {
	off: 'off',
	one: 'track',
	all: 'context',
}
const NEXT_REPEAT: Record<Repeat, Repeat> = {
	off: 'context',
	context: 'track',
	track: 'off',
}

const listeners = new Set<() => void>()
let state: MusicState = {
	playback: null,
	status: 'Looking for music…',
	spotifyStatus: 'Connecting to Discord’s Spotify session…',
	bridgeStatus: androidBridge
		? 'Looking for the Music Controls app…'
		: 'Android only',
	spotifyConnected: false,
	bridgeConnected: false,
	busy: false,
	dismissed: false,
}
/** Last song from the Music Controls app (Music Bridge), or media keys. */
let bridgePlayback: Playback | null = null
let pausedSince = 0
let art: { version: number; uri: string | null } = { version: -1, uri: null }
let optimistic: {
	until: number
	playing?: boolean
	shuffle?: boolean
	repeat?: Repeat
} | null = null

function setState(patch: Partial<MusicState>) {
	if ('playback' in patch) {
		const next = patch.playback
		if (!next) {
			patch.dismissed = false
			pausedSince = 0
		} else if (next.playing) {
			// A new listening session after a long pause shows the player again.
			if (pausedSince && Date.now() - pausedSince >= IDLE_HIDE_MS)
				patch.dismissed = false
			pausedSince = 0
		} else if (!pausedSince) pausedSince = Date.now()
	}
	state = { ...state, ...patch }
	for (const listener of listeners) listener()
}

export const getState = () => state

export function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function useMusic() {
	return useSyncExternalStore(subscribe, getState)
}

export function dismissPlayer() {
	if (state.playback) setState({ dismissed: true })
}

export function restorePlayer() {
	setState({ dismissed: false })
}

/** Playback position now, extrapolated from the last known position. */
export function positionOf(p: Playback, now = Date.now()) {
	const elapsed = p.playing ? Math.max(0, now - p.updatedAt) : 0
	const value = p.position + elapsed
	return Math.max(0, p.duration ? Math.min(p.duration, value) : value)
}

export function formatTime(ms: number) {
	const total = Math.max(0, Math.floor(ms / 1000))
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function fromSpotify(p: SpotifyPlayback): Playback {
	return {
		id: `spotify:${p.id}`,
		title: p.title,
		artist: p.artist,
		artwork: p.artwork,
		duration: p.duration,
		position: p.position,
		updatedAt: p.updatedAt,
		playing: p.playing,
		shuffle: p.shuffle,
		repeat: p.repeat,
		canShuffle: true,
		canRepeat: true,
		app: 'Spotify',
		packageName: SPOTIFY_PACKAGE,
		source: 'spotify',
	}
}

/**
 * Spotify through Discord wins while it plays (it also works on iOS and can search);
 * Music Bridge covers every other app, and Spotify too when Discord's connection is missing.
 */
function combine() {
	const spotify = getSpotify()
	const sp = spotify.playback?.deviceId ? spotify.playback : null
	const bridge = bridgePlayback
	const bridgeIsSpotify = bridge?.packageName === SPOTIFY_PACKAGE
	let playback: Playback | null = null
	if (sp && (sp.playing || !bridge?.playing || bridgeIsSpotify))
		playback = fromSpotify(sp)
	else playback = bridge ?? (sp ? fromSpotify(sp) : null)

	const statuses = [
		spotify.connected ? `Spotify: ${spotify.status}` : null,
		androidBridge ? state.bridgeStatus : null,
	].filter(Boolean)
	setState({
		playback,
		busy: playback?.source === 'spotify' && spotify.busy,
		spotifyConnected: spotify.connected,
		spotifyStatus: spotify.status,
		status: statuses.join('\n') || spotify.status,
	})
}

function bridgeStatusOf(bridge: BridgeState | null, playing: boolean) {
	if (!bridge)
		return playing
			? 'Playing. Install the Music Controls app to see the song.'
			: 'Install the Music Controls app for YouTube Music and SoundCloud.'
	if (!bridge.access)
		return 'The Music Controls app has no notification access.'
	return bridge.active
		? `Connected to ${bridge.app ?? 'your player'}`
		: 'Connected. Nothing is playing.'
}

async function artworkOf(bridge: BridgeState) {
	if (bridge.artVersion === art.version) return art.uri
	const data = await bridgeArt()
	art = { version: bridge.artVersion, uri: data ?? bridge.artUrl ?? null }
	return art.uri
}

async function pollBridge() {
	const bridge = await bridgeState()
	const playing = await isPlaying()
	let playback: Playback | null = null

	if (bridge?.access && bridge.active) {
		const now = Date.now()
		const hold = optimistic && optimistic.until > now ? optimistic : null
		const reported = {
			playing: bridge.playing,
			shuffle: bridge.shuffle,
			repeat: REPEATS[bridge.repeat] ?? 'off',
		}
		// Drop the optimistic value once the player agrees with it.
		if (
			hold &&
			(hold.playing ?? reported.playing) === reported.playing &&
			(hold.shuffle ?? reported.shuffle) === reported.shuffle &&
			(hold.repeat ?? reported.repeat) === reported.repeat
		)
			optimistic = null
		const modes = !NO_MODES.has(bridge.package ?? '')
		playback = {
			id: bridge.artKey ?? `${bridge.package}|${bridge.title}`,
			title: bridge.title || 'Unknown song',
			artist: bridge.artist || bridge.app || '',
			artwork: await artworkOf(bridge),
			duration: bridge.duration,
			position: bridge.position,
			updatedAt: now,
			playing: hold?.playing ?? reported.playing,
			shuffle: hold?.shuffle ?? reported.shuffle,
			repeat: hold?.repeat ?? reported.repeat,
			canShuffle: modes && bridge.canShuffle,
			canRepeat: modes && bridge.canRepeat,
			app: bridge.app ?? null,
			packageName: bridge.package ?? null,
			source: 'bridge',
		}
	} else if (!bridge && playing) {
		// No Music Controls app: something plays, so offer media keys without song details.
		playback = {
			id: 'media-keys',
			title: 'Music playing',
			artist: 'Install the Music Controls app to see the song',
			artwork: null,
			duration: 0,
			position: 0,
			updatedAt: Date.now(),
			playing: true,
			shuffle: false,
			repeat: 'off',
			canShuffle: false,
			canRepeat: false,
			app: null,
			packageName: null,
			source: 'keys',
		}
	}

	bridgePlayback = playback
	state = {
		...state,
		bridgeConnected: !!bridge?.access,
		bridgeStatus: bridgeStatusOf(bridge, playing),
	}
	combine()
}

export function refresh() {
	void refreshSpotify()
	if (!androidBridge) return Promise.resolve()
	void command('request')
	return pollBridge()
}

export async function control(action: ControlAction, seekMs?: number) {
	const playback = state.playback
	if (!playback) return
	if (playback.source === 'spotify') return spotifyControl(action, seekMs)

	if (playback.source === 'keys') {
		if (action === 'play' || action === 'pause') await press('playPause')
		else if (action === 'next' || action === 'previous') await press(action)
		return
	}

	const until = Date.now() + OPTIMISTIC_MS
	const show = (patch: Partial<Playback>) => {
		bridgePlayback = { ...playback, ...patch }
		combine()
	}
	switch (action) {
		case 'play':
		case 'pause':
			optimistic = { ...optimistic, until, playing: action === 'play' }
			show({ playing: action === 'play' })
			await command(action)
			break
		case 'shuffle':
			optimistic = { ...optimistic, until, shuffle: !playback.shuffle }
			show({ shuffle: !playback.shuffle })
			await command('shuffle')
			break
		case 'repeat': {
			const repeat = NEXT_REPEAT[playback.repeat]
			optimistic = { ...optimistic, until, repeat }
			show({ repeat })
			await command('repeat')
			break
		}
		case 'seek':
			show({ position: seekMs ?? 0, updatedAt: Date.now() })
			await command('seek', seekMs ?? 0)
			break
		default:
			await command(action)
	}
	setTimeout(() => void pollBridge(), 300)
}

/** Opens the song in Spotify, or the app that plays. */
export function openPlayer(playback: Playback) {
	const url =
		playback.source === 'spotify'
			? `https://open.spotify.com/track/${encodeURIComponent(playback.id.replace(/^spotify:/, ''))}`
			: playback.packageName
				? `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${playback.packageName};end`
				: null
	if (url) Linking.openURL(url).catch(() => {})
}

/** Starts Spotify and, on Android, polls the Music Controls app while Discord is in the foreground. */
export function startMusic(): () => void {
	const stops = [startSpotify(), subscribeSpotify(combine)]
	if (androidBridge) {
		let timer: ReturnType<typeof setInterval> | null = null
		const run = () => {
			if (timer) return
			void command('request')
			void pollBridge()
			timer = setInterval(() => void pollBridge(), POLL_MS)
		}
		const halt = () => {
			if (timer) clearInterval(timer)
			timer = null
		}
		if (AppState.currentState === 'active') run()
		const sub = AppState.addEventListener('change', next =>
			next === 'active' ? run() : halt(),
		)
		stops.push(() => {
			halt()
			sub.remove()
		})
	}
	return () => {
		for (const stop of stops) stop()
		bridgePlayback = null
	}
}
