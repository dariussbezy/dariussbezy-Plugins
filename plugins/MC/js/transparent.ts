import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { lookupModule } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { createElement, useMemo, useState } from 'react'
import {
	Platform,
	requireNativeComponent,
	StyleSheet,
	View,
} from 'react-native'
import { useSettings } from './shared'
import type { ReactElement } from 'react'
import type { LayoutChangeEvent, TextStyle, ViewStyle } from 'react-native'
import type { TransparencyLevel } from './shared'

/**
 * Transparent look, shared by the player card and the settings preview.
 *
 * On iOS the real blur comes from Discord's own native VisualEffectView (the one behind the Quest dock),
 * found at runtime. Without it, and on Android, the blur is faked with layered translucent fills: a tinted body that lets the chat show through, a thin light
 * edge. Every colour comes from Discord's Tokens, only the alpha is changed.
 * Other plugins that must match this look can copy this file as it is.
 */

/**
 * Opacity per transparency level (high = most see-through). The Transparent YOUBAR plugin has the
 * identical table (same tint, border and highlight logic), so the two look the same at the same level.
 * body: tint alpha of the surface colour (dark / light theme), edge: border alpha, sheen: top sheen,
 * spot: specular spot, text: strength of the soft text shadow that keeps the player text readable.
 */
export const TransparencyTable: Record<
	TransparencyLevel,
	{
		bodyDark: number
		bodyLight: number
		edge: number
		sheen: number
		spot: number
		text: number
	}
> = {
	low: {
		bodyDark: 0.82,
		bodyLight: 0.86,
		edge: 0.3,
		sheen: 0.12,
		spot: 0.22,
		text: 0,
	},
	medium: {
		bodyDark: 0.62,
		bodyLight: 0.68,
		edge: 0.38,
		sheen: 0.16,
		spot: 0.3,
		text: 0.25,
	},
	high: {
		bodyDark: 0.42,
		bodyLight: 0.5,
		edge: 0.46,
		sheen: 0.2,
		spot: 0.38,
		text: 0.5,
	},
}

/** Alpha of the other layers. */
export const TransparentAlpha = {
	edgeTop: 0.7,
	chip: 0.16,
	chipBorder: 0.28,
	track: 0.3,
	shadow: 0.35,
} as const

export const TransparentRadius = { card: 20, chip: 22 } as const

type Rgb = [number, number, number]

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa` and `rgb()/rgba()`; returns null for anything else. */
export function parseColor(color: unknown): Rgb | null {
	if (typeof color !== 'string') return null
	const text = color.trim()
	if (text.startsWith('#')) {
		let hex = text.slice(1)
		if (hex.length === 3 || hex.length === 4)
			hex = [...hex].map(c => c + c).join('')
		if (hex.length !== 6 && hex.length !== 8) return null
		const n = Number.parseInt(hex.slice(0, 6), 16)
		return Number.isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
	}
	const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text)
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** Same colour with another alpha; falls back to the input when it cannot be parsed. */
export function withAlpha(color: unknown, alpha: number): string | undefined {
	const rgb = parseColor(color)
	if (!rgb) return typeof color === 'string' ? color : undefined
	return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`
}

export interface TransparentLook {
	dark: boolean
	/** Outer card: radius, hairline border, soft shadow (iOS) and the tinted translucent body. */
	card: ViewStyle
	/** Inner clip that keeps the layers inside the rounded corners. */
	clip: ViewStyle
	/** Rim light drawn over the card edge: bright top-left, soft bottom-right, like a lit bevel. */
	rim: ViewStyle
	/** Faint second ring just inside the rim, the edge thickness. */
	rimInner: ViewStyle
	/** One pixel specular line along the top edge. */
	edge: ViewStyle
	/** Round translucent chip behind a control button. */
	chip: ViewStyle
	/** The main (play) chip: bigger and filled with the accent. */
	chipMain: ViewStyle
	/** Chip of a switched-on control (shuffle, repeat): tinted with the accent colour. */
	chipActive: ViewStyle
	/** Unfilled part of the progress line. */
	track: string | undefined
	/** Discord link colour, used to tint the settings preview backdrop. */
	accent: string | undefined
	/** Soft shadow for the player text, strength grows with transparency. */
	text: TextStyle
	/** Top sheen and specular spot alpha of this level. */
	sheen: number
	spot: number
	/** Handle pill colour. */
	handle: string | undefined
	/** Knob ring of the progress. */
	ring: string
}

const WHITE = '255,255,255'
const BLACK = '0,0,0'

export function resolveColor(
	theme: unknown,
	names: string[],
): string | undefined {
	const { colors, internal } = Tokens.default as any
	for (const name of names) {
		try {
			if (!colors[name]) continue
			const value = internal.resolveSemanticColor(theme, colors[name])
			if (typeof value === 'string' && value !== 'transparent') return value
		} catch {}
	}
	return undefined
}

type BlurComponent = (props: Record<string, unknown>) => ReactElement | null
let blurView: BlurComponent | null | undefined

const isComponent = (value: unknown): value is BlurComponent =>
	typeof value === 'function' ||
	(!!value && typeof value === 'object' && '$$typeof' in value)

/** Where the native blur view was found, for the settings screen. */
let blurSource: string | null = null
export const blurStatus = () => {
	findBlurView()
	return blurSource
}

/** Discord's native blur view, iOS only; null when it cannot be found or is not a component. */
function findBlurView(): BlurComponent | null {
	if (Platform.OS !== 'ios') return null
	if (blurView !== undefined) return blurView
	blurView = null
	const candidates: [string, () => unknown][] = [
		...['BackgroundBlurView', 'BackgroundBlurFill', 'VisualEffectView'].map(
			(name): [string, () => unknown] => [
				`Design.${name}`,
				() => (Design as any)[name],
			],
		),
		...[
			'VisualEffectView',
			'VisualEffectViewIOS',
			'VisualEffectViewThemed',
			'BackgroundBlurView',
			'BackgroundBlurFill',
		].map((name): [string, () => unknown] => [
			name,
			() => {
				const found = lookupModule(withName<any>(name))[0] as any
				return found?.default ?? found
			},
		]),
		[
			'native VisualEffectView',
			() => requireNativeComponent('VisualEffectView'),
		],
	]
	for (const [source, get] of candidates) {
		try {
			const component = get()
			if (isComponent(component)) {
				blurView = component
				blurSource = source
				break
			}
		} catch {}
	}
	return blurView ?? null
}

/** Real blur layer to put first inside the card; renders nothing where it is unavailable. */
export function TransparentBlur({
	dark,
}: {
	dark: boolean
}): ReactElement | null {
	const View = findBlurView()
	if (!View) return null
	return createElement(View, {
		pointerEvents: 'none',
		style: StyleSheet.absoluteFill,
		blurAmount: 0.5,
		blurEffectName: dark
			? 'UIBlurEffectStyleSystemThinMaterialDark'
			: 'UIBlurEffectStyleSystemThinMaterialLight',
	})
}

export function buildTransparent(
	theme: unknown,
	level: TransparencyLevel,
): TransparentLook {
	const row = TransparencyTable[level]
	const dark = theme !== 'light'
	const surface = resolveColor(theme, [
		'BACKGROUND_SURFACE_HIGH',
		'MOBILE_FLOATINGBAR_BACKGROUND',
		'BACKGROUND_BASE_LOW',
	])
	const accent = resolveColor(theme, ['TEXT_LINK', 'INTERACTIVE_ACTIVE'])
	const muted = resolveColor(theme, ['INTERACTIVE_MUTED', 'TEXT_MUTED'])
	// Stays fairly opaque even when the native blur layer is present: that layer may not blur, and the text must stay readable.
	const alpha = dark ? row.bodyDark : row.bodyLight
	const body = withAlpha(surface, alpha)
	return {
		dark,
		card: {
			borderWidth: 1,
			borderColor: `rgba(${WHITE},${dark ? row.edge * 0.6 : row.edge})`,
			// Android draws elevation shadows through a translucent body, so only iOS gets a shadow.
			...(Platform.OS === 'ios'
				? {
						shadowColor: `rgb(${BLACK})`,
						shadowOpacity: TransparentAlpha.shadow,
						shadowRadius: 18,
						shadowOffset: { width: 0, height: -4 },
					}
				: null),
			backgroundColor: body,
		},
		clip: { overflow: 'hidden' },
		rim: {
			...StyleSheet.absoluteFillObject,
			borderWidth: 1.5,
			borderTopColor: `rgba(${WHITE},0.75)`,
			borderLeftColor: `rgba(${WHITE},0.4)`,
			borderRightColor: `rgba(${WHITE},0.12)`,
			borderBottomColor: `rgba(${WHITE},0.22)`,
		},
		rimInner: {
			...StyleSheet.absoluteFillObject,
			margin: 3,
			borderWidth: 1,
			borderTopColor: `rgba(${WHITE},0.18)`,
			borderLeftColor: `rgba(${WHITE},0.1)`,
			borderRightColor: `rgba(${WHITE},0.04)`,
			borderBottomColor: `rgba(${WHITE},0.08)`,
		},
		edge: {
			position: 'absolute',
			top: 0,
			left: 8,
			right: 8,
			height: 1,
			backgroundColor: `rgba(${WHITE},${TransparentAlpha.edgeTop})`,
		},
		chip: {
			borderRadius: TransparentRadius.chip,
			borderWidth: 1,
			borderTopColor: `rgba(${WHITE},0.6)`,
			borderLeftColor: `rgba(${WHITE},0.35)`,
			borderRightColor: `rgba(${WHITE},0.12)`,
			borderBottomColor: `rgba(${WHITE},0.2)`,
			backgroundColor: `rgba(${WHITE},${TransparentAlpha.chip})`,
		},
		chipMain: {
			borderRadius: TransparentRadius.chip,
			borderWidth: 1.5,
			borderTopColor: `rgba(${WHITE},0.85)`,
			borderLeftColor: `rgba(${WHITE},0.5)`,
			borderRightColor: `rgba(${WHITE},0.2)`,
			borderBottomColor: `rgba(${WHITE},0.3)`,
			backgroundColor: withAlpha(accent, 0.6),
		},
		chipActive: {
			borderRadius: TransparentRadius.chip,
			borderWidth: 1.5,
			borderColor: accent ?? `rgba(${WHITE},0.9)`,
			backgroundColor: withAlpha(accent, 0.38),
		},
		track: `rgba(${WHITE},${TransparentAlpha.track})`,
		accent,
		text: {
			textShadowColor: `rgba(${BLACK},${row.text})`,
			textShadowRadius: 4,
			textShadowOffset: { width: 0, height: 1 },
		},
		sheen: row.sheen,
		spot: row.spot,
		handle: withAlpha(muted, 0.9),
		ring: `rgba(${WHITE},0.9)`,
	}
}

/** The transparent look for the current theme, or null when the "Transparent" setting is off. */
export function useTransparent(): TransparentLook | null {
	const { transparent, transparency } = useSettings()
	const { theme } = (Design as any).useThemeContext()
	return useMemo(
		() => (transparent ? buildTransparent(theme, transparency) : null),
		[transparent, transparency, theme],
	)
}

/** Corner radii of the card, in px: top-left, top-right, bottom-right, bottom-left. */
export type Corners = [number, number, number, number]

type SvgKit = Record<string, any>
let svgKit: SvgKit | null | undefined

/** react-native-svg as shipped inside Discord: gradients for the rim lighting. */
function findSvg(): SvgKit | null {
	if (svgKit !== undefined) return svgKit
	svgKit = null
	try {
		const found = lookupModule(
			withProps<any>(
				'Svg',
				'Path',
				'Defs',
				'LinearGradient',
				'RadialGradient',
				'Stop',
			),
		)[0] as any
		const kit = found?.default?.Svg ? found.default : found
		if (kit?.Svg && kit.Path && kit.Defs && kit.Stop) svgKit = kit
	} catch {}
	return svgKit ?? null
}

export const svgStatus = () => (findSvg() ? 'found' : null)

/** Rounded rectangle with a radius per corner, inset by `inset` px. */
function cardPath(w: number, h: number, corners: Corners, inset: number) {
	const [tl, tr, br, bl] = corners.map(r => Math.max(0, r - inset))
	const x = inset
	const y = inset
	const iw = w - inset * 2
	const ih = h - inset * 2
	return (
		`M${x + tl},${y}H${x + iw - tr}A${tr},${tr} 0 0 1 ${x + iw},${y + tr}` +
		`V${y + ih - br}A${br},${br} 0 0 1 ${x + iw - br},${y + ih}` +
		`H${x + bl}A${bl},${bl} 0 0 1 ${x},${y + ih - bl}` +
		`V${y + tl}A${tl},${tl} 0 0 1 ${x + tl},${y}Z`
	)
}

/**
 * The lit card edge: a soft top sheen, a rim that is bright at the top-left and bottom-right, a faint
 * inner ring for thickness and a specular spot. Drawn with SVG gradients, so there are
 * no hard bands. Falls back to plain Views when react-native-svg cannot be found.
 */
const FLUSH: ViewStyle = {
	borderBottomWidth: 0,
	borderBottomLeftRadius: 0,
	borderBottomRightRadius: 0,
}

export function TransparentRim({
	look,
	corners,
	id,
	flush = false,
	shape,
}: {
	look: TransparentLook
	corners: Corners
	/** The bottom edge is not drawn: the card sits flush on the YouBar. */
	flush?: boolean
	/** Corners and bottom overdraw for the current card height, to follow the drag and snap animation. */
	shape?: (height: number) => { corners: Corners; extra: number }
	/** Unique per instance: SVG gradient ids are global. */
	id: string
}): ReactElement | null {
	const [size, setSize] = useState({ w: 0, h: 0 })
	const kit = findSvg()
	const geo = shape?.(size.h) ?? { corners, extra: flush ? 12 : 0 }
	const radius = { borderRadius: geo.corners[0] }
	const flat = geo.extra > 0
	if (!kit)
		return createElement(
			View,
			{ pointerEvents: 'none', style: StyleSheet.absoluteFill },
			createElement(View, { style: [look.rim, radius, flat ? FLUSH : null] }),
			createElement(View, {
				style: [look.rimInner, radius, flat ? FLUSH : null],
			}),
		)
	const { Svg, Path, Defs, LinearGradient, RadialGradient, Stop } = kit
	const stop = (offset: number, rgb: string, opacity: number) =>
		createElement(Stop, {
			offset: String(offset),
			stopColor: `rgb(${rgb})`,
			stopOpacity: opacity,
		})
	const top = look.dark ? 1 : 0.9
	// Flush: the shape is drawn taller than the card, so its bottom edge falls outside the clip.
	const w = size.w
	const h = size.h + geo.extra
	const body = size.w > 0 && size.h > 0
	return createElement(
		View,
		{
			pointerEvents: 'none',
			style: StyleSheet.absoluteFill,
			onLayout: (e: LayoutChangeEvent) => {
				const { width, height } = e.nativeEvent.layout
				setSize(prev =>
					Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1
						? prev
						: { w: width, h: height },
				)
			},
		},
		body &&
			createElement(
				Svg,
				{ width: w, height: h },
				createElement(
					Defs,
					null,
					createElement(
						LinearGradient,
						{ id: `${id}-sheen`, x1: '0', y1: '0', x2: '0', y2: '1' },
						stop(0, WHITE, look.sheen * (look.dark ? 1 : 1.8)),
						stop(0.5, WHITE, 0.03),
						stop(1, WHITE, 0),
					),
					createElement(
						LinearGradient,
						{ id: `${id}-rim`, x1: '0', y1: '0', x2: '1', y2: '1' },
						stop(0, WHITE, 0.85 * top),
						stop(0.3, WHITE, 0.18),
						stop(0.7, WHITE, 0.12),
						stop(1, WHITE, 0.6 * top),
					),
					createElement(
						RadialGradient,
						{
							id: `${id}-spot`,
							cx: '0.12',
							cy: '0',
							rx: '0.5',
							ry: '0.9',
							fx: '0.12',
							fy: '0',
						},
						stop(0, WHITE, look.spot * (look.dark ? 1 : 1.5)),
						stop(1, WHITE, 0),
					),
				),
				createElement(Path, {
					d: cardPath(w, h, geo.corners, 0),
					fill: `url(#${id}-sheen)`,
				}),
				createElement(Path, {
					d: cardPath(w, h, geo.corners, 0),
					fill: `url(#${id}-spot)`,
				}),
				createElement(Path, {
					d: cardPath(w, h, geo.corners, 0.75),
					fill: 'none',
					stroke: `url(#${id}-rim)`,
					strokeWidth: 1.5,
				}),
				createElement(Path, {
					d: cardPath(w, h, geo.corners, 4),
					fill: 'none',
					stroke: `url(#${id}-rim)`,
					strokeOpacity: 0.28,
					strokeWidth: 1,
				}),
			),
	)
}
