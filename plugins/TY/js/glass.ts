import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { useMemo } from 'react'
import type { Level } from './shared'

/**
 * Transparent style tokens. MUST stay identical to the table in Music Controls (plugins/MC/js/glass.ts):
 * the same level has to look the same on the player card and on the YouBar, so the numbers, the surface
 * tint and the light border/highlight rule are copied one to one.
 */
export interface LevelLook {
	/** Alpha of the tinted body (the surface colour of the theme), per theme. High = most see-through. */
	body: { dark: number; light: number }
	/** Alpha of the 1px light border. */
	border: number
	/** Alpha of the brightest band of the top highlight. */
	highlight: number
	shadow: number
}

export const LevelLooks: Record<Level, LevelLook> = {
	low: {
		body: { dark: 0.82, light: 0.86 },
		border: 0.14,
		highlight: 0.08,
		shadow: 0.22,
	},
	medium: {
		body: { dark: 0.62, light: 0.68 },
		border: 0.2,
		highlight: 0.13,
		shadow: 0.28,
	},
	high: {
		body: { dark: 0.42, light: 0.5 },
		border: 0.26,
		highlight: 0.18,
		shadow: 0.34,
	},
}

export const LevelLabels: Record<Level, { label: string; subLabel: string }> = {
	low: { label: 'Low', subLabel: 'More tint, less see-through.' },
	medium: { label: 'Medium', subLabel: 'The default look.' },
	high: { label: 'High', subLabel: 'Most see-through.' },
}

/** Share of the bar height and alpha weight of the stacked bands that fake a vertical gradient. */
export const HIGHLIGHT_BANDS: [number, number][] = Array.from(
	{ length: 20 },
	(_, i) => [0.03, (1 - i / 20) ** 2.2],
)

/** Rounded corners used when Discord's own radius cannot be read. */
export const FALLBACK_RADIUS = 20

/** Applies an alpha to a resolved `#rgb`, `#rrggbb(aa)`, `rgb()` or `rgba()` colour. */
export function withAlpha(color: string | undefined, alpha: number) {
	if (!color) return undefined
	const a = Math.max(0, Math.min(1, alpha))
	let r: number
	let g: number
	let b: number
	let base = 1
	const hex = color.trim().match(/^#([0-9a-f]{3,8})$/i)
	if (hex) {
		let h = hex[1]
		if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('')
		if (h.length !== 6 && h.length !== 8) return undefined
		r = Number.parseInt(h.slice(0, 2), 16)
		g = Number.parseInt(h.slice(2, 4), 16)
		b = Number.parseInt(h.slice(4, 6), 16)
		if (h.length === 8) base = Number.parseInt(h.slice(6, 8), 16) / 255
	} else {
		const rgb = color
			.trim()
			.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/i)
		if (!rgb) return undefined
		r = Number(rgb[1])
		g = Number(rgb[2])
		b = Number(rgb[3])
		if (rgb[4] != null) base = Number(rgb[4])
	}
	return `rgba(${r}, ${g}, ${b}, ${Number((a * base).toFixed(3))})`
}

export interface GlassColors {
	body: string | undefined
	border: string | undefined
	/** Light sheen, brighter in the top bands. */
	highlight: (alpha: number) => string
	shadow: string | undefined
}

/** Resolves the theme's semantic colours (works in dark and light themes). */
export function useGlassColors(level: Level): GlassColors {
	const { theme } = (Design as any).useThemeContext()
	return useMemo(() => {
		const { colors: palette, internal } = Tokens.default as any
		const resolve = (names: string[]) => {
			for (const name of names) {
				try {
					if (!palette[name]) continue
					const value = internal.resolveSemanticColor(theme, palette[name])
					if (typeof value === 'string' && value !== 'transparent') return value
				} catch {}
			}
			return undefined
		}
		const look = LevelLooks[level]
		const surface = resolve([
			'BACKGROUND_SURFACE_HIGH',
			'MOBILE_FLOATINGBAR_BACKGROUND',
			'BACKGROUND_BASE_LOW',
		])
		return {
			body: withAlpha(
				surface,
				theme === 'light' ? look.body.light : look.body.dark,
			),
			// Dark themes get a white light edge; light themes use the theme's own border colour.
			border:
				theme === 'light'
					? withAlpha(resolve(['BORDER_STRONG', 'BORDER_NORMAL']), 0.5)
					: `rgba(255, 255, 255, ${look.border})`,
			highlight: (alpha: number) => `rgba(255, 255, 255, ${alpha})`,
			shadow: withAlpha(resolve(['BACKGROUND_BASE_LOWEST']), 1),
		}
	}, [theme, level])
}
