import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
	AccessibilityInfo,
	Animated,
	AppState,
	Easing,
	Image,
	PanResponder,
	Platform,
	Pressable,
	View,
} from 'react-native'
import { gestureHandler, scrub } from './gesture'
import { Icons, iconId } from './icons'
import { control, formatTime, openPlayer, positionOf, useMusic } from './music'
import { openSearch } from './search'
import { lazyStyles, setDockMode, useSettings } from './shared'
import {
	findSvg,
	resolveColor,
	TransparentBlur,
	TransparentRadius,
	TransparentRim,
	useTransparent,
	withAlpha,
} from './transparent'
import type { Playback } from './music'
import type { ButtonId, PlayerMode, Settings } from './shared'

// Built once; the bundler rewrites a bare `Animated.View` member access.
const AnimatedView = Animated.createAnimatedComponent(View)

const IDLE_HIDE_MS = 5 * 60 * 1000
/** Horizontal wave period in px, shared by the wave function and the loop animation. */
const WAVE_PERIOD = 168
const WAVE_HEIGHT = 20
const COLUMN_STEP = 2
/** Duration of one wave loop when the tempo of the song is unknown. */
const STEADY_LOOP_MS = 8000

const SAMPLE: Playback = {
	id: 'preview',
	title: 'Song title',
	artist: 'Artist',
	album: null,
	artwork: null,
	artworkUrl: null,
	duration: 180_000,
	position: 45_000,
	updatedAt: 0,
	playing: false,
	shuffle: false,
	repeat: 'off',
	canShuffle: true,
	canRepeat: true,
	app: 'Music app',
	packageName: null,
	source: 'bridge',
}

/** Whether the player should currently be shown above the YouBar. */
export function usePlayerVisible() {
	const { playback, dismissed } = useMusic()
	const { alwaysShow } = useSettings()
	const [idle, setIdle] = useState(false)
	const id = playback?.id
	const playing = playback?.playing

	useEffect(() => {
		setIdle(false)
		if (id && !playing) {
			const timer = setTimeout(() => setIdle(true), IDLE_HIDE_MS)
			return () => clearTimeout(timer)
		}
	}, [id, playing])

	if (alwaysShow) return true
	return !dismissed && !!playback && (!!playing || !idle)
}

function useReduceMotion() {
	const [reduce, setReduce] = useState(false)
	useEffect(() => {
		let alive = true
		AccessibilityInfo.isReduceMotionEnabled()
			.then(value => alive && setReduce(value))
			.catch(() => {})
		const sub = AccessibilityInfo.addEventListener(
			'reduceMotionChanged',
			setReduce,
		)
		return () => {
			alive = false
			sub.remove()
		}
	}, [])
	return reduce
}

function useAppActive() {
	const [active, setActive] = useState(AppState.currentState === 'active')
	useEffect(() => {
		const sub = AppState.addEventListener('change', s =>
			setActive(s === 'active'),
		)
		return () => sub.remove()
	}, [])
	return active
}

/** Smooth periodic wave (a sum of three sines), centered on the middle of the lane. */
function wave(x: number, period: number, amplitude: number, phase: number) {
	const u = (x / period) * Math.PI * 2 + phase
	return (
		WAVE_HEIGHT / 2 +
		amplitude *
			(0.62 * Math.sin(u) +
				0.28 * Math.sin(2 * u + 1.3) +
				0.1 * Math.sin(3 * u + 0.4))
	)
}

/**
 * SVG path of one wave tile: samples every 6 px joined by cubic curves (Catmull-Rom), so the line
 * stays smooth at any size instead of a chain of short straight pieces.
 */
function wavePath(
	length: number,
	period: number,
	amplitude: number,
	phase: number,
) {
	const step = 6
	const points: [number, number][] = []
	for (let x = -step; x <= length + step * 2; x += step)
		points.push([x, wave(x, period, amplitude, phase)])
	let d = `M${points[1][0]},${points[1][1].toFixed(2)}`
	for (let i = 1; i < points.length - 2; i++) {
		const [p0, p1, p2, p3] = [
			points[i - 1],
			points[i],
			points[i + 1],
			points[i + 2],
		]
		const c1x = p1[0] + (p2[0] - p0[0]) / 6
		const c1y = p1[1] + (p2[1] - p0[1]) / 6
		const c2x = p2[0] - (p3[0] - p1[0]) / 6
		const c2y = p2[1] - (p3[1] - p1[1]) / 6
		d += `C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0]},${p2[1].toFixed(2)}`
	}
	return d
}

interface SeekProps {
	/** 0..1 */
	progress: number
	duration: number
	disabled: boolean
	onPreview(fraction: number | null): void
	onSeek(fraction: number): void
}

/**
 * Animated wave progress bar.
 * custom: Discord has no native wave/progress-scrub component (the Quest progress indicator is a
 * plain bar), so this is built from Views styled with Tokens; the straight mode uses Design.Slider.
 */
function WaveBar({
	progress,
	playing,
	disabled,
	onPreview,
	onSeek,
}: SeekProps & {
	playing: boolean
}) {
	const styles = useWaveStyles()
	const skin = useTransparent()
	const [width, setWidth] = useState(1)
	const [drag, setDrag] = useState<number | null>(null)
	const reduceMotion = useReduceMotion()
	const shift = useRef(new Animated.Value(0)).current
	const swell = useRef(new Animated.Value(1)).current
	const live = useRef({ width, disabled, onPreview, onSeek })
	live.current = { width, disabled, onPreview, onSeek }
	const startX = useRef(0)

	const pan = useMemo(() => {
		const fraction = (x: number) =>
			Math.max(0, Math.min(1, x / live.current.width))
		return PanResponder.create({
			onStartShouldSetPanResponder: () => !live.current.disabled,
			onMoveShouldSetPanResponder: (_, g) =>
				!live.current.disabled && Math.abs(g.dx) > Math.abs(g.dy),
			onPanResponderGrant: e => {
				startX.current = e.nativeEvent.locationX
				const value = fraction(startX.current)
				setDrag(value)
				live.current.onPreview(value)
			},
			onPanResponderMove: (_, g) => {
				const value = fraction(startX.current + g.dx)
				setDrag(value)
				live.current.onPreview(value)
			},
			onPanResponderRelease: (_, g) => {
				const value = fraction(startX.current + g.dx)
				setDrag(null)
				live.current.onPreview(null)
				live.current.onSeek(value)
			},
			onPanResponderTerminate: () => {
				setDrag(null)
				live.current.onPreview(null)
			},
			// The parent card listens for swipes; never hand the scrub gesture over to it.
			onPanResponderTerminationRequest: () => false,
		})
	}, [])

	// iOS: Discord's root gesture handler takes over touches, so scrubbing needs a native gesture there.
	const handler = useMemo(gestureHandler, [])
	const gesture = useMemo(() => {
		if (!handler || Platform.OS !== 'ios') return null
		const fraction = (x: number) =>
			Math.max(0, Math.min(1, x / live.current.width))
		const show = (x: number) => {
			if (live.current.disabled) return
			const value = fraction(x)
			setDrag(value)
			live.current.onPreview(value)
		}
		return handler.Gesture.Pan()
			.runOnJS(true)
			.minDistance(0)
			.failOffsetY([-16, 16])
			.onBegin(event => {
				if (live.current.disabled) return
				scrub.active = true
				show(event.x)
			})
			.onUpdate(event => show(event.x))
			.onEnd(event => {
				if (live.current.disabled) return
				const value = fraction(event.x)
				setDrag(null)
				live.current.onPreview(null)
				live.current.onSeek(value)
			})
			.onFinalize((_event, success) => {
				scrub.active = false
				if (!success) {
					setDrag(null)
					live.current.onPreview(null)
				}
			})
	}, [handler])

	const { theme } = (Design as any).useThemeContext()
	const color = resolveColor(theme, ['TEXT_LINK', 'INTERACTIVE_ACTIVE'])
	// react-native-svg needs a plain color string, not a Discord token.
	const kit = color ? findSvg() : null
	const Svg = kit?.Svg
	const Path = kit?.Path
	const tileWidth = width + WAVE_PERIOD + COLUMN_STEP + 1
	const front = useMemo(
		() => (kit ? wavePath(tileWidth, WAVE_PERIOD, 5.2, 0) : ''),
		[kit, tileWidth],
	)
	// Only when react-native-svg cannot be found: thin columns under the wave.
	const columns = useMemo(
		() =>
			kit
				? []
				: Array.from({ length: Math.ceil(tileWidth / COLUMN_STEP) }, (_, i) => {
						const y = wave(i * COLUMN_STEP, WAVE_PERIOD, 5.2, 0)
						const mid = WAVE_HEIGHT / 2
						return {
							left: i * COLUMN_STEP,
							top: Math.min(y, mid) - 1,
							height: Math.abs(y - mid) + 2,
						}
					}),
		[kit, tileWidth],
	)

	useEffect(() => {
		if (!playing || reduceMotion) return
		shift.setValue(0)
		const loop = Animated.loop(
			Animated.timing(shift, {
				toValue: 1,
				duration: STEADY_LOOP_MS,
				easing: Easing.linear,
				useNativeDriver: true,
				isInteraction: false,
			}),
		)
		loop.start()
		return () => loop.stop()
	}, [playing, reduceMotion, shift])

	// The wave swells while playing and settles to a quiet ripple when paused.
	useEffect(() => {
		Animated.timing(swell, {
			toValue: playing ? 1 : 0.28,
			duration: reduceMotion ? 0 : 450,
			easing: Easing.out(Easing.cubic),
			useNativeDriver: true,
			isInteraction: false,
		}).start()
	}, [playing, reduceMotion, swell])
	const frontX = shift.interpolate({
		inputRange: [0, 1],
		outputRange: [0, -WAVE_PERIOD],
	})

	const value = drag ?? progress
	const bar = (
		<View
			{...(gesture ? { collapsable: false } : pan.panHandlers)}
			accessibilityRole="adjustable"
			accessibilityLabel="Song progress"
			accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
			accessibilityActions={[
				{ name: 'increment', label: 'Forward ten percent' },
				{ name: 'decrement', label: 'Back ten percent' },
			]}
			onAccessibilityAction={e =>
				onSeek(
					Math.max(
						0,
						Math.min(
							1,
							progress +
								(e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1),
						),
					),
				)
			}
			onLayout={e => setWidth(Math.max(1, e.nativeEvent.layout.width))}
			style={styles.hit}
		>
			<View pointerEvents="none" style={styles.lane}>
				<View
					style={[
						styles.track,
						// Only the part still to play: the played part is the wave itself.
						{ left: Math.max(0, Math.min(width, width * value)) },
						skin?.track ? { backgroundColor: skin.track } : null,
					]}
				/>
				<View
					style={[
						styles.clip,
						{ width: Math.max(0, Math.min(width, width * value)) },
					]}
				>
					{kit ? (
						<AnimatedView
							style={[styles.layers, { transform: [{ scaleY: swell }] }]}
						>
							<AnimatedView
								style={[
									styles.tile,
									{
										width: tileWidth,
										transform: [{ translateX: frontX }],
									},
								]}
							>
								<Svg width={tileWidth} height={WAVE_HEIGHT}>
									<Path
										d={front}
										fill="none"
										stroke={color}
										strokeWidth={3}
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</Svg>
							</AnimatedView>
						</AnimatedView>
					) : (
						<AnimatedView
							style={[
								styles.tile,
								{ width: tileWidth, transform: [{ translateX: frontX }] },
							]}
						>
							{columns.map(column => (
								<View key={column.left} style={[styles.column, column]} />
							))}
						</AnimatedView>
					)}
				</View>
			</View>
			<View
				pointerEvents="none"
				style={[
					styles.halo,
					{
						left: Math.max(-6, Math.min(width - 18, value * width - 12)),
						transform: [{ scale: drag === null ? 1 : 1.35 }],
					},
				]}
			/>
			<View
				pointerEvents="none"
				style={[
					styles.knob,
					skin ? { borderWidth: 2, borderColor: skin.ring } : null,
					{ left: Math.max(0, Math.min(width - 12, value * width - 6)) },
				]}
			/>
		</View>
	)
	return gesture && handler ? (
		<handler.GestureDetector gesture={gesture}>{bar}</handler.GestureDetector>
	) : (
		bar
	)
}

function StraightBar({ progress, disabled, onPreview, onSeek }: SeekProps) {
	return (
		<Design.Slider
			step={0.001}
			minimumValue={0}
			maximumValue={1}
			value={progress}
			onSlidingStart={() => !disabled && onPreview(progress)}
			onValueChange={value => !disabled && onPreview(value)}
			onSlidingComplete={value => {
				onPreview(null)
				if (!disabled) onSeek(value)
			}}
		/>
	)
}

function ControlButton({ id, playback }: { id: ButtonId; playback: Playback }) {
	const styles = useControlStyles()
	const skin = useTransparent()
	const { busy } = useMusic()
	const mode = playback.repeat
	const spec = {
		Shuffle: {
			names: Icons.Shuffle,
			label: playback.shuffle ? 'Shuffle on' : 'Shuffle off',
			active: playback.shuffle,
			disabled: !playback.canShuffle,
			press: () => control('shuffle'),
		},
		Previous: {
			names: Icons.Previous,
			label: 'Previous',
			active: false,
			disabled: false,
			press: () => control('previous'),
		},
		Play: {
			names: playback.playing ? Icons.Pause : Icons.Play,
			label: playback.playing ? 'Pause' : 'Play',
			active: true,
			disabled: false,
			press: () => control(playback.playing ? 'pause' : 'play'),
		},
		Next: {
			names: Icons.Next,
			label: 'Next',
			active: false,
			disabled: false,
			press: () => control('next'),
		},
		Repeat: {
			names: Icons.Repeat,
			label:
				mode === 'track'
					? 'Repeat one'
					: mode === 'context'
						? 'Repeat all'
						: 'Repeat off',
			active: mode !== 'off',
			disabled: !playback.canRepeat,
			press: () => control('repeat'),
		},
		Search: {
			names: Icons.Search,
			label: 'Search Spotify',
			active: false,
			disabled: false,
			press: openSearch,
		},
	}[id]
	const disabled = spec.disabled || (busy && id !== 'Search')

	const icon = iconId(...spec.names)
	if (!icon)
		return (
			<Design.Button
				text={spec.label}
				size="sm"
				variant="secondary"
				disabled={disabled}
				onPress={spec.press}
			/>
		)

	if (skin)
		return (
			// custom: Design.IconButton draws a square press outline, so the transparent buttons are round Pressables
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={spec.label}
				accessibilityState={{ selected: spec.active, disabled }}
				disabled={disabled}
				onPress={spec.press}
				style={({ pressed }) => [
					styles.slot,
					id === 'Play'
						? skin.chipMain
						: spec.active
							? skin.chipActive
							: skin.chip,
					{
						opacity: spec.disabled ? 0.4 : pressed ? 0.7 : 1,
						transform: [{ scale: pressed ? 0.94 : 1 }],
					},
				]}
			>
				<Design.TableRow.Icon source={icon} />
				{id === 'Repeat' && mode === 'track' && (
					// custom: a small pill in the corner of the chip, so the 1 does not sit on the icon
					<View
						pointerEvents="none"
						style={[styles.pill, { backgroundColor: skin.accent }]}
					>
						<Design.Text variant="text-xxs/semibold" color="text-strong">
							1
						</Design.Text>
					</View>
				)}
			</Pressable>
		)

	return (
		<View style={styles.slot}>
			<Design.IconButton
				icon={icon}
				size="md"
				variant={spec.active ? 'primary' : 'tertiary'}
				accessibilityLabel={spec.label}
				accessibilityState={{ selected: spec.active }}
				disabled={disabled}
				onPress={spec.press}
			/>
			{id === 'Repeat' && mode === 'track' && (
				<View pointerEvents="none" style={styles.badge}>
					<Design.Text variant="text-xxs/semibold" color="text-default">
						1
					</Design.Text>
				</View>
			)}
		</View>
	)
}

/**
 * Player content (no surface): the dock supplies the card, handle and gestures.
 * Also used standalone, inside a Card, for the settings preview.
 */
/** Opens the Spotify search sheet; shown while nothing is playing. */
function SearchButton() {
	const icon = iconId(...Icons.Search)
	return icon ? (
		<Design.IconButton
			icon={icon}
			size="sm"
			variant="secondary"
			accessibilityLabel="Search Spotify"
			onPress={openSearch}
		/>
	) : (
		<Design.Button
			text="Search"
			size="sm"
			variant="secondary"
			onPress={openSearch}
		/>
	)
}

export function PlayerBody({
	mode,
	preview = false,
}: {
	mode: PlayerMode
	preview?: boolean
}) {
	const music = useMusic()
	const settings = useSettings()
	const skin = useTransparent()
	const styles = usePlayerStyles()
	const appActive = useAppActive()
	const compact = mode === 'compact'
	const playback = music.playback ?? (preview ? SAMPLE : null)
	const [dragFraction, setDragFraction] = useState<number | null>(null)
	const [, tick] = useState(0)
	// Preview in settings: never animate or tick.
	const playingNow = !!playback?.playing && appActive && !preview
	useEffect(() => {
		if (!playingNow) return
		const timer = setInterval(() => tick(n => n + 1), 1000)
		return () => clearInterval(timer)
	}, [playingNow])
	// A new song resets any half-finished scrub.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on the song id
	useEffect(() => setDragFraction(null), [playback?.id])

	if (!playback && !preview && settings.alwaysShow)
		return (
			<View style={styles.body}>
				<View style={styles.row}>
					<View style={styles.titles}>
						<Design.Text
							variant="text-md/semibold"
							color="text-muted"
							numberOfLines={1}
						>
							Nothing playing
						</Design.Text>
					</View>
					{music.spotifyConnected && (
						<View style={styles.controls}>
							<SearchButton />
						</View>
					)}
				</View>
			</View>
		)

	if (!playback)
		return preview ? (
			<Design.Stack spacing={0}>
				<Design.Text variant="text-sm/medium" color="text-muted">
					{music.status}
				</Design.Text>
			</Design.Stack>
		) : null

	const position =
		dragFraction === null
			? positionOf(playback)
			: dragFraction * playback.duration
	const progress = playback.duration ? position / playback.duration : 0
	const openTrack = () => openPlayer(playback)
	const buttons = (
		['Shuffle', 'Previous', 'Play', 'Next', 'Repeat', 'Search'] as const
	)
		.filter(id => settings[`${mode}${id}` as keyof Settings])
		// Hidden where the player cannot do them (SoundCloud, media keys).
		.filter(id => id !== 'Shuffle' || playback.canShuffle)
		.filter(id => id !== 'Repeat' || playback.canRepeat)
		// Search finds songs on Spotify, so it needs Discord's Spotify connection.
		.filter(id => id !== 'Search' || music.spotifyConnected || preview)
	const controls = buttons.map(id => (
		<ControlButton key={id} id={id} playback={playback} />
	))
	const seekProps: SeekProps = {
		progress,
		duration: playback.duration,
		disabled: preview || music.busy || !playback.duration,
		onPreview: setDragFraction,
		onSeek: fraction => control('seek', fraction * playback.duration),
	}

	return (
		<View
			pointerEvents={preview ? 'none' : 'auto'}
			accessibilityElementsHidden={preview}
			importantForAccessibility={preview ? 'no-hide-descendants' : 'auto'}
			style={styles.body}
		>
			<Design.Stack spacing={compact ? 0 : 10}>
				<View style={styles.row}>
					<Pressable
						accessibilityRole={compact ? 'button' : 'link'}
						accessibilityLabel={
							compact
								? 'Expand Music Controls'
								: `Open ${playback.app ?? 'the player'}`
						}
						onPress={compact ? () => setDockMode('expanded') : openTrack}
						onLongPress={openTrack}
						style={styles.info}
					>
						{playback.artwork ? (
							<Image
								source={{ uri: playback.artwork }}
								style={compact ? styles.artCompact : styles.art}
							/>
						) : null}
						<View style={styles.titles}>
							<Design.Text
								variant="text-md/semibold"
								color="text-strong"
								numberOfLines={1}
								style={skin?.text}
							>
								{playback.title}
							</Design.Text>
							{!compact && (
								<Design.Text
									variant="text-sm/medium"
									color="text-muted"
									numberOfLines={1}
									style={skin?.text}
								>
									{playback.artist}
								</Design.Text>
							)}
						</View>
					</Pressable>
					{compact && controls.length > 0 && (
						<View style={styles.controls}>{controls}</View>
					)}
				</View>
				{!compact && (
					<>
						<View>
							{settings.animatedWave ? (
								<WaveBar {...seekProps} playing={playingNow} />
							) : (
								<StraightBar {...seekProps} />
							)}
							<Design.Stack
								direction="horizontal"
								justify="space-between"
								style={styles.times}
							>
								<Design.Text
									variant="text-xs/medium"
									color="text-muted"
									style={skin?.text}
								>
									{formatTime(position)}
								</Design.Text>
								<Design.Text
									variant="text-xs/medium"
									color="text-muted"
									style={skin?.text}
								>
									{formatTime(playback.duration)}
								</Design.Text>
							</Design.Stack>
						</View>
						{controls.length > 0 && (
							<Design.Stack
								direction="horizontal"
								align="center"
								justify="space-between"
							>
								{controls}
							</Design.Stack>
						)}
					</>
				)}
			</Design.Stack>
		</View>
	)
}

/** Settings preview: the same content on a plain card, or the transparent card over a coloured backdrop. */
export function Player({ previewMode }: { previewMode: PlayerMode }) {
	const skin = useTransparent()
	const styles = usePlayerStyles()
	if (skin) {
		const accent = skin.accent
		return (
			// custom: a coloured backdrop so the see-through card is visible in the preview
			<View
				style={[styles.backdrop, { backgroundColor: withAlpha(accent, 0.28) }]}
			>
				<View
					style={[
						styles.blob,
						styles.blobA,
						{ backgroundColor: withAlpha(accent, 0.7) },
					]}
				/>
				<View
					style={[
						styles.blob,
						styles.blobB,
						{ backgroundColor: withAlpha(accent, 0.45) },
					]}
				/>
				<View
					style={[
						skin.card,
						skin.clip,
						{ borderRadius: TransparentRadius.card },
					]}
				>
					<TransparentBlur dark={skin.dark} frosted={skin.frosted} />
					<TransparentRim
						look={skin}
						id="mc-preview"
						corners={[
							TransparentRadius.card,
							TransparentRadius.card,
							TransparentRadius.card,
							TransparentRadius.card,
						]}
					/>
					<View pointerEvents="none" style={skin.edge} />
					<PlayerBody mode={previewMode} preview />
				</View>
			</View>
		)
	}
	return (
		<Design.Card
			variant="primary"
			border="none"
			shadow="none"
			style={{ borderRadius: 16, overflow: 'hidden' }}
		>
			<PlayerBody mode={previewMode} preview />
		</Design.Card>
	)
}

const usePlayerStyles = lazyStyles(() =>
	Design.createStyles({
		body: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
		// custom: the title must take the space the controls leave, which Stack does not do
		row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
		controls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
		info: {
			flex: 1,
			minWidth: 0,
			flexDirection: 'row',
			alignItems: 'center',
			gap: 12,
		},
		titles: { flex: 1, minWidth: 0 },
		art: { width: 48, height: 48, borderRadius: 8 },
		artCompact: { width: 32, height: 32, borderRadius: 16 },
		times: { marginTop: -4 },
		backdrop: { padding: 12, borderRadius: 24, overflow: 'hidden' },
		blob: { position: 'absolute', width: 90, height: 90, borderRadius: 45 },
		blobA: { top: -20, left: 20 },
		blobB: { bottom: -30, right: 30 },
	}),
)

const useControlStyles = lazyStyles(() =>
	Design.createStyles({
		slot: {
			width: 44,
			height: 44,
			alignItems: 'center',
			justifyContent: 'center',
		},
		pill: {
			position: 'absolute',
			top: 0,
			right: 0,
			minWidth: 16,
			height: 16,
			borderRadius: 8,
			alignItems: 'center',
			justifyContent: 'center',
		},
		badge: {
			position: 'absolute',
			top: 15,
			left: 18,
			width: 8,
			height: 12,
			alignItems: 'center',
			justifyContent: 'center',
		},
	}),
)

const useWaveStyles = lazyStyles(() =>
	Design.createStyles({
		hit: { height: 32, justifyContent: 'center', overflow: 'hidden' },
		lane: { height: WAVE_HEIGHT, overflow: 'hidden' },
		track: {
			position: 'absolute',
			top: 8,
			left: 0,
			right: 0,
			height: 2,
			borderRadius: 1,
			backgroundColor: Tokens.default.colors.INTERACTIVE_MUTED,
		},
		clip: {
			position: 'absolute',
			top: 0,
			left: 0,
			height: WAVE_HEIGHT,
			overflow: 'hidden',
		},
		layers: {
			position: 'absolute',
			top: 0,
			left: 0,
			right: 0,
			height: WAVE_HEIGHT,
		},
		tile: { position: 'absolute', top: 0, left: 0, height: WAVE_HEIGHT },
		halo: {
			position: 'absolute',
			top: 4,
			width: 24,
			height: 24,
			borderRadius: 12,
			backgroundColor: Tokens.default.colors.TEXT_LINK,
			opacity: 0.2,
		},
		column: {
			position: 'absolute',
			width: COLUMN_STEP + 1,
			borderRadius: 1,
			backgroundColor: Tokens.default.colors.TEXT_LINK,
		},
		knob: {
			position: 'absolute',
			top: 10,
			width: 12,
			height: 12,
			borderRadius: 6,
			backgroundColor: Tokens.default.colors.TEXT_LINK,
		},
	}),
)
