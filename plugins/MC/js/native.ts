import { callNativeMethod, getBridgeInfo } from '@valenced/modules/native'
import { Platform } from 'react-native'

declare module '@valenced/modules/native' {
	export interface NativeMethods {
		'musicControls.press': [[key: MediaKey], boolean]
		'musicControls.playing': [[], boolean]
		'musicControls.state': [[], BridgeState | null]
		'musicControls.art': [[], string | null]
		'musicControls.command': [
			[command: BridgeCommand, position?: number],
			boolean,
		]
	}
}

export type MediaKey = 'playPause' | 'next' | 'previous'
export type BridgeCommand =
	| MediaKey
	| 'request'
	| 'play'
	| 'pause'
	| 'seek'
	| 'shuffle'
	| 'repeat'

/** What the Music Bridge app reported last. Times are in milliseconds. */
export interface BridgeState {
	/** False when Music Bridge is installed but has no notification access. */
	access: boolean
	/** False when no app has a media session. */
	active: boolean
	app?: string | null
	package?: string | null
	title?: string | null
	artist?: string | null
	album?: string | null
	playing: boolean
	position: number
	duration: number
	actions: number
	canShuffle: boolean
	canRepeat: boolean
	shuffle: boolean
	repeat: 'off' | 'one' | 'all'
	artKey?: string | null
	/** Changes whenever the cover changes, even within one song. */
	artVersion: number
	/** A web address for the cover, when the player gives one instead of an image. */
	artUrl?: string | null
	/** How long ago the state arrived. */
	age: number
}

export const androidBridge = Platform.OS === 'android'

export const APP_URL =
	'https://github.com/dariussbezy/Music-Controls/raw/main/app/MusicControls.apk'

/** Sends a media key to the app that is playing. False when the native part is not loaded. */
export async function press(key: MediaKey) {
	try {
		return await callNativeMethod('musicControls.press', [key])
	} catch {
		return false
	}
}

export async function bridgeState() {
	try {
		return await callNativeMethod('musicControls.state', [])
	} catch {
		return null
	}
}

export async function bridgeArt() {
	try {
		return await callNativeMethod('musicControls.art', [])
	} catch {
		return null
	}
}

export async function command(name: BridgeCommand, position = 0) {
	try {
		return await callNativeMethod('musicControls.command', [name, position])
	} catch {
		return false
	}
}

/** Checks the native part directly, keeping the error for the diagnostics. */
export async function probe(): Promise<{ ok: boolean; detail: string }> {
	const bridge = getBridgeInfo()
	const loader = bridge ? `${bridge.name} v${bridge.version}` : 'no bridge'
	try {
		const playing = await callNativeMethod('musicControls.playing', [])
		return { ok: true, detail: `${loader}, ${playing ? 'playing' : 'idle'}` }
	} catch (error) {
		return {
			ok: false,
			detail: `${loader}: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

/** Whether any app is playing audio right now. */
export async function isPlaying() {
	try {
		return await callNativeMethod('musicControls.playing', [])
	} catch {
		return false
	}
}
