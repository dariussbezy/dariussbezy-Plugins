import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { proxify } from '@valenced/utils/proxy'
import { useRef, useState } from 'react'
import { PanResponder, View } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'

const THUMB = 28
const TRACK = 4

const useStyles = proxify(() =>
	Design.createStyles({
		area: {
			height: 44,
			justifyContent: 'center',
			paddingHorizontal: THUMB / 2,
		},
		track: {
			height: TRACK,
			borderRadius: TRACK / 2,
			backgroundColor: Tokens.default.colors.INTERACTIVE_MUTED,
		},
		fill: {
			position: 'absolute',
			left: 0,
			height: TRACK,
			borderRadius: TRACK / 2,
			backgroundColor: Tokens.default.colors.TEXT_BRAND,
		},
		thumb: {
			position: 'absolute',
			top: -(THUMB - TRACK) / 2,
			width: THUMB,
			height: THUMB,
			borderRadius: THUMB / 2,
			backgroundColor: Tokens.default.colors.TEXT_BRAND,
		},
	}),
)

/**
 * A plain line-and-dot slider.
 * custom: Discord's own Slider did not react to dragging on iOS.
 */
export function DurationSlider({
	min,
	max,
	value,
	onChange,
	onCommit,
}: {
	min: number
	max: number
	value: number
	onChange: (value: number) => void
	onCommit: (value: number) => void
}) {
	const styles = useStyles()
	const [width, setWidth] = useState(0)
	const track = useRef<View>(null)
	const left = useRef(0)
	const state = useRef({ width, min, max, onChange, onCommit })
	state.current = { width, min, max, onChange, onCommit }
	const last = useRef(value)

	const valueAt = (pageX: number) => {
		const { width, min, max } = state.current
		const ratio =
			width > 0 ? Math.min(1, Math.max(0, (pageX - left.current) / width)) : 0
		return Math.round(min + ratio * (max - min))
	}

	const responder = useRef(
		PanResponder.create({
			onStartShouldSetPanResponder: () => true,
			onMoveShouldSetPanResponder: () => true,
			onPanResponderTerminationRequest: () => false,
			onPanResponderGrant: event => {
				const pageX = event.nativeEvent.pageX
				track.current?.measureInWindow(x => {
					left.current = x
					last.current = valueAt(pageX)
					state.current.onChange(last.current)
				})
			},
			onPanResponderMove: event => {
				const next = valueAt(event.nativeEvent.pageX)
				if (next === last.current) return
				last.current = next
				state.current.onChange(next)
			},
			onPanResponderRelease: () => state.current.onCommit(last.current),
			// iOS can end the touch this way instead of a release: the chosen value must still be saved.
			onPanResponderTerminate: () => state.current.onCommit(last.current),
		}),
	).current

	const ratio = max > min ? (value - min) / (max - min) : 0
	const x = ratio * width

	return (
		<View style={styles.area} {...responder.panHandlers}>
			<View
				ref={track}
				style={styles.track}
				onLayout={(event: LayoutChangeEvent) =>
					setWidth(event.nativeEvent.layout.width)
				}
			>
				<View style={[styles.fill, { width: x }]} />
				<View
					pointerEvents="none"
					style={[styles.thumb, { left: x - THUMB / 2 }]}
				/>
			</View>
		</View>
	)
}
