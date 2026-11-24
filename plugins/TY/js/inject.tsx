import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { getModules, lookupModule } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
	withProps,
} from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
import { Children, cloneElement, createElement, isValidElement } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { useMc } from './bridge'
import {
	FALLBACK_RADIUS,
	HIGHLIGHT_BANDS,
	LevelLooks,
	useGlassColors,
} from './glass'
import { useSettings } from './shared'
import type { Filter, FilterGenerator } from '@valenced/modules/finders/filters'
import type { ReactElement, ReactNode } from 'react'
import type { GlassColors } from './glass'
import type { Level } from './shared'

type AnyFn = (...args: any[]) => any

const nameOf = (value: unknown) => {
	const fn = value as { displayName?: string; name?: string } | undefined
	return fn?.displayName || fn?.name || ''
}

/** Matches a component exported plain, memoized, forwardRef-ed or as `default`. */
const withComponentName = createFilterGenerator(
	([name]: [string], _, exports) => {
		const e = exports as Record<string, unknown> | undefined
		const d = e?.default as Record<string, unknown> | undefined
		return [e, d, e?.type, d?.type, e?.render, d?.render].some(
			candidate => nameOf(candidate) === name,
		)
	},
	([name]: [string]) => `dariuss.transparent-youbar.component(${name})`,
	FilterScopes.Initialized,
) as unknown as FilterGenerator<
	(
		name: string,
	) => Filter<{ Result: object; Scopes: [typeof FilterScopes.Initialized] }>
>

type SvgKit = Record<string, any>
let svgKit: SvgKit | null | undefined
let svgMissAt = 0
let svgMisses = 0

/** react-native-svg as shipped inside Discord; a miss is tried again later, with a growing wait. */
function findSvg(): SvgKit | null {
	if (svgKit) return svgKit
	const wait = Math.min(60_000, 3000 * 2 ** Math.max(0, svgMisses - 1))
	if (svgKit === null && Date.now() - svgMissAt < wait) return null
	svgKit = null
	try {
		const found = lookupModule(
			withProps<any>('Svg', 'Rect', 'Defs', 'LinearGradient', 'Stop'),
			{ cached: false, initialize: true },
		)[0] as any
		const kit = found?.default?.Svg ? found.default : found
		if (kit?.Svg && kit.Rect && kit.Defs && kit.LinearGradient && kit.Stop)
			svgKit = kit
	} catch {}
	if (!svgKit) {
		svgMissAt = Date.now()
		svgMisses++
	}
	return svgKit ?? null
}

/**
 * The top highlight as one smooth gradient. Android draws the edges of the stacked band views as
 * visible lines, so it uses this when react-native-svg is found (iOS keeps the bands).
 */
function SmoothHighlight({ alpha }: { alpha: number }) {
	const kit = findSvg()
	if (!kit) return null
	const { Svg, Rect, Defs, LinearGradient, Stop } = kit
	const top = HIGHLIGHT_BANDS[0]?.[1] ?? 1
	return createElement(
		Svg,
		{ style: StyleSheet.absoluteFill, width: '100%', height: '100%' },
		createElement(
			Defs,
			null,
			createElement(
				LinearGradient,
				{ id: 'ty-highlight', x1: '0', y1: '0', x2: '0', y2: '1' },
				createElement(Stop, {
					offset: '0',
					stopColor: 'rgb(255,255,255)',
					stopOpacity: alpha * top,
				}),
				createElement(Stop, {
					offset: '0.55',
					stopColor: 'rgb(255,255,255)',
					stopOpacity: 0,
				}),
			),
		),
		createElement(Rect, {
			x: 0,
			y: 0,
			width: '100%',
			height: '100%',
			fill: 'url(#ty-highlight)',
		}),
	)
}

/** The layers drawn inside the bar: a soft top highlight and a light top edge (not when joined to the player). */
export function GlassLayers({
	colors,
	level,
	radius,
	joined,
}: {
	colors: GlassColors
	level: Level
	radius: number
	/** Joined to the Music Controls card: square top corners and no highlight at the seam. */
	joined: boolean
}) {
	const look = LevelLooks[level]
	return (
		// custom: Discord has no transparent surface component, so the sheen is stacked translucent views
		<View
			pointerEvents="none"
			style={[
				StyleSheet.absoluteFill,
				{
					borderBottomLeftRadius: radius,
					borderBottomRightRadius: radius,
					borderTopLeftRadius: joined ? 0 : radius,
					borderTopRightRadius: joined ? 0 : radius,
					overflow: 'hidden',
				},
			]}
		>
			{joined ? null : Platform.OS === 'android' ? (
				<SmoothHighlight alpha={look.highlight} />
			) : (
				HIGHLIGHT_BANDS.map(([height, weight], index) => (
					<View
						// biome-ignore lint/suspicious/noArrayIndexKey: static list
						key={index}
						style={{
							height: `${height * 100}%`,
							backgroundColor: colors.highlight(look.highlight * weight),
						}}
					/>
				))
			)}
			{joined ? null : (
				<View
					style={{
						position: 'absolute',
						top: 0,
						left: radius * 0.6,
						right: radius * 0.6,
						height: StyleSheet.hairlineWidth * 2,
						backgroundColor: colors.highlight(Math.min(1, look.border * 2.4)),
					}}
				/>
			)}
		</View>
	)
}

/** Reads a numeric corner radius out of a style, ignoring animated values. */
function radiusOf(style: unknown) {
	try {
		const flat = StyleSheet.flatten(style as never) as Record<string, unknown>
		for (const key of ['borderRadius', 'borderTopLeftRadius']) {
			const value = flat?.[key]
			if (typeof value === 'number' && value > 0) return value
		}
	} catch {}
	return FALLBACK_RADIUS
}

/** True once `YouBarBackground` is patched: it then carries the fill, so the root must not tint twice. */
let backgroundPatched = false

/** Clears the opaque background and the native shadow of Discord's own wrapper layers. */
const CLEAR_WRAPPER = {
	backgroundColor: 'transparent',
	shadowOpacity: 0,
	elevation: 0,
} as const

/** Android draws a native shadow through a translucent surface as a black shape, so only iOS gets one. */
const softShadow = (color: string | undefined, opacity: number) =>
	Platform.OS === 'ios'
		? {
				shadowColor: color,
				shadowOpacity: opacity,
				shadowRadius: 16,
				shadowOffset: { width: 0, height: 6 },
			}
		: { shadowOpacity: 0, elevation: 0 }

/**
 * Runs after `YouBarBackground` (Discord's own bar surface, an opaque child of the bar) or, when that
 * is not found, after `YouBar`: tints the surface and adds the glass layers. While the Music Controls
 * card is shown the bar follows its level and joins it: square top corners, and no fill, border,
 * highlight or shadow of its own, because the card is drawn behind the bar (it extends over the bar's
 * area), so a second fill would stack on the card's and make the bar look more opaque than the card.
 */
function useGlass(rendered: ReactNode, where: string): ReactNode {
	const settings = useSettings()
	const mc = useMc()
	const level = mc ? mc.level : settings.level
	const colors = useGlassColors(level)
	if (!settings.enabled || !isValidElement(rendered)) return rendered
	const root = rendered as ReactElement<any>
	// The YouBar root only tints when no separate background component was found; otherwise its own
	// opaque colour and shadow are cleared so nothing dark shows behind the translucent surface.
	if (where === 'YouBar' && backgroundPatched)
		return cloneElement(root, { style: [root.props.style, CLEAR_WRAPPER] })

	const look = LevelLooks[level]
	const radius = radiusOf(root.props.style)
	const joined = mc !== null
	const style = joined
		? {
				backgroundColor: 'transparent',
				borderTopLeftRadius: 0,
				borderTopRightRadius: 0,
				borderBottomLeftRadius: radius,
				borderBottomRightRadius: radius,
				borderWidth: 0,
				shadowOpacity: 0,
				elevation: 0,
			}
		: {
				backgroundColor: colors.body,
				borderRadius: radius,
				borderWidth: 1,
				borderColor: colors.border,
				...softShadow(colors.shadow, look.shadow),
			}
	const layers = (
		<GlassLayers
			key="transparent-youbar"
			colors={colors}
			level={level}
			radius={radius}
			joined={joined}
		/>
	)
	if (where === 'YouBarBackground') {
		// Discord's surface is animated and keeps its own opaque colour, so it is replaced by a plain
		// view with the same position, which only loses the animated corner radius of the quest dock.
		return (
			// custom: Discord has no transparent surface component
			<View pointerEvents="none" style={[positionOf(root.props.style), style]}>
				{layers}
			</View>
		)
	}
	return cloneElement(
		root,
		{ style: [root.props.style, style] },
		layers,
		...Children.toArray(root.props.children),
	)
}

/**
 * Discord draws two things that keep the bar from being see-through: the user's nameplate behind it
 * and a dark shade under it. Each is removed by rendering nothing in its place, when the matching
 * setting is on (both are on by default).
 */
function useHidden(
	rendered: ReactNode,
	setting: 'hideNameplate' | 'hideShade',
) {
	const settings = useSettings()
	return settings.enabled && settings[setting] ? null : rendered
}

/** Position and size of a style (no colours, no animated values), absolute-fill when unreadable. */
function positionOf(style: unknown) {
	const keys = [
		'position',
		'top',
		'bottom',
		'left',
		'right',
		'width',
		'height',
		'margin',
		'marginTop',
		'marginBottom',
		'marginLeft',
		'marginRight',
		'marginHorizontal',
		'marginVertical',
		'flex',
		'alignSelf',
		'zIndex',
	]
	try {
		const flat = StyleSheet.flatten(style as never) as Record<string, unknown>
		const out: Record<string, unknown> = {}
		for (const key of keys) {
			const value = flat?.[key]
			if (typeof value === 'number' || typeof value === 'string')
				out[key] = value
		}
		if (Object.keys(out).length) return out
	} catch {}
	return StyleSheet.absoluteFill
}

/** Finds a component by name and patches its render function with `after`, through `cleanup`. */
function patchByName(
	name: string,
	cleanup: (...undo: (() => void)[]) => void,
	onError: (error: unknown) => void,
	transform: (rendered: ReactNode) => ReactNode,
	/** Also look the module up by its source path, when the component's name may not match. */
	path?: string,
) {
	const patched = new WeakSet<object>()
	const apply = (namespace: unknown) => {
		try {
			const ns = namespace as Record<string, unknown> | undefined
			const inner = (ns?.default ?? ns) as Record<string, unknown> | undefined
			const hasType = typeof inner?.type === 'function'
			const hasRender = typeof inner?.render === 'function'
			const target = (hasType || hasRender ? inner : ns) as
				| Record<string, AnyFn>
				| undefined
			const key = hasType ? 'type' : hasRender ? 'render' : 'default'
			if (!target || typeof target[key] !== 'function' || patched.has(target))
				return
			patched.add(target)
			if (name === 'YouBarBackground') backgroundPatched = true
			cleanup(
				after(target, key, rendered => {
					try {
						return transform(rendered as ReactNode)
					} catch {
						return rendered
					}
				}),
			)
		} catch (error) {
			onError(error)
		}
	}
	cleanup(getModules(withComponentName(name), apply, { returnNamespace: true }))
	if (path) cleanup(getModuleWithImportedPath(path, apply))
}

/**
 * Patches Discord's `YouBarBackground` and `YouBar` render functions in place, so the elements keep
 * their type and name and other plugins (Music Controls, Better You Bar) still find and wrap them.
 */
export function patchYouBar(
	cleanup: (...undo: (() => void)[]) => void,
	onError: (error: unknown) => void,
) {
	backgroundPatched = false
	cleanup(() => {
		backgroundPatched = false
	})
	patchByName('YouBarBackground', cleanup, onError, rendered =>
		useGlass(rendered, 'YouBarBackground'),
	)
	patchByName('YouBar', cleanup, onError, rendered =>
		useGlass(rendered, 'YouBar'),
	)
	patchByName(
		'YouBarNameplate',
		cleanup,
		onError,
		rendered => useHidden(rendered, 'hideNameplate'),
		'modules/main_tabs_v2/native/you_bar/YouBarNameplate.tsx',
	)
	patchByName(
		'YouBarFloatingShade',
		cleanup,
		onError,
		rendered => useHidden(rendered, 'hideShade'),
		'modules/main_tabs_v2/native/you_bar/YouBarFloatingShade.tsx',
	)
}
