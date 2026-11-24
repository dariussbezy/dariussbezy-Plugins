import {
	callNativeMethod,
	callNativeMethodSync,
} from '@valenced/modules/native'
import {
	existsSync,
	getConstants,
	readFileSync,
	writeFileSync,
} from '@valenced/modules/native/fs'

/**
 * The look options. The wallpaper is given to Valenced when the theme registers, before plugin
 * storage is ready, so the options live in a small file read at startup; changes need a restart.
 */
export type Look = {
	wallpaper: boolean
	/** Wallpaper blur radius, like desktop's panel blur. */
	blur: number
	/** How opaque the surfaces over the wallpaper are (desktop: 0.6). */
	dimming: number
	/** Wallpaper brightness. */
	brightness: number
	/** Channel names one step lighter, so they stay readable over the wallpaper. */
	brightChannels: boolean
}

export const DefaultLook: Look = {
	wallpaper: true,
	blur: 8,
	dimming: 0.6,
	brightness: 1,
	brightChannels: true,
}

export const Limits = {
	blur: { min: 0, max: 20, step: 2 },
	dimming: { min: 0.3, max: 0.95, step: 0.05 },
	brightness: { min: 0.2, max: 1, step: 0.1 },
} as const

const clamp = (
	value: unknown,
	{ min, max }: { min: number; max: number },
	fallback: number,
) =>
	typeof value === 'number' && Number.isFinite(value)
		? Math.min(max, Math.max(min, value))
		: fallback

function file() {
	const { data } = getConstants()
	return `${data.replace(/\/$/, '')}/dariuss-midnight-look.json`
}

export function readLook(): Look {
	try {
		const path = file()
		if (!existsSync(path)) return { ...DefaultLook }
		const saved = JSON.parse(readFileSync(path)) as Partial<Look>
		return {
			wallpaper: saved.wallpaper !== false,
			blur: clamp(saved.blur, Limits.blur, DefaultLook.blur),
			dimming: clamp(saved.dimming, Limits.dimming, DefaultLook.dimming),
			brightness: clamp(
				saved.brightness,
				Limits.brightness,
				DefaultLook.brightness,
			),
			brightChannels: saved.brightChannels !== false,
		}
	} catch {
		return { ...DefaultLook }
	}
}

export function writeLook(look: Look) {
	writeFileSync(file(), JSON.stringify(look))
}

/** Dark-theme channel colors, one step lighter (desktop text-3 for names, text-4 when muted). */
const BrightChannels: Record<string, string> = {
	CHANNELS_DEFAULT: '#91A6CA',
	CHANNEL_ICON: '#91A6CA',
	REDESIGN_CHANNEL_NAME_TEXT: '#91A6CA',
	MESSAGES_ITEM_CHANNEL_TEXT_DEFAULT: '#91A6CA',
	REDESIGN_CHANNEL_NAME_MUTED_TEXT: '#566C9F',
	// Read channels and other quiet text: halfway between desktop text-4 and text-3.
	TEXT_MUTED: '#748AB5',
}

export function applyLook<
	P extends { semantic: Record<string, Record<string, string>> },
>(palette: P, look: Look): P {
	if (!look.brightChannels) return palette
	const semantic: Record<string, Record<string, string>> = {}
	for (const [base, colors] of Object.entries(palette.semantic))
		semantic[base] =
			base === 'light' ? colors : { ...colors, ...BrightChannels }
	return { ...palette, semantic }
}

/**
 * Valenced keeps the colors a theme had when it was picked, so a new palette or a changed option
 * would only show after picking Midnight again. This rewrites the saved colors while Midnight is
 * the selected theme; Discord shows them after its next restart.
 */
export async function refreshColors(
	id: string,
	palette: { semantic: Record<string, Record<string, string>> },
) {
	try {
		const state = JSON.parse(
			(
				callNativeMethodSync as unknown as (
					name: string,
					args: unknown[],
				) => string
			)('valenced.themes.getState', []),
		)
		const colors = state?.colors
		if (colors?.plugin !== id) return
		const values = applyLook(palette, readLook())
		if (JSON.stringify(colors.values) === JSON.stringify(values)) return
		await (
			callNativeMethod as unknown as (
				name: string,
				args: unknown[],
			) => Promise<unknown>
		)('valenced.themes.setColors', [JSON.stringify({ ...colors, values })])
	} catch {
		// The colors stay as they were picked.
	}
}
