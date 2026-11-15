import { Design } from '@valenced/discord/design'
import { View } from 'react-native'

const CAP = 99

/** A red dot with the number of unread pings on it. */
export function CountBadge({
	count,
	floating = false,
}: {
	count: number
	floating?: boolean
}) {
	// custom: the theme's critical color is pink in Midnight; a count badge should always be red
	const background = '#F23F43'
	return (
		// custom: Discord has no native count badge component to overlay on an icon button
		<View
			pointerEvents="none"
			style={{
				// Inside the button's corner: the YouBar clips anything outside it.
				...(floating
					? { position: 'absolute', top: 3, right: 3, zIndex: 1 }
					: {}),
				minWidth: floating ? 14 : 16,
				height: floating ? 14 : 16,
				borderRadius: floating ? 7 : 8,
				paddingHorizontal: floating ? 3 : 4,
				alignItems: 'center',
				justifyContent: 'center',
				backgroundColor: background,
			}}
		>
			<Design.Text
				variant="text-xs/bold"
				style={{
					color: '#FFFFFF',
					fontSize: floating ? 9 : 11,
					lineHeight: floating ? 12 : 14,
					includeFontPadding: false,
				}}
			>
				{count > CAP ? `${CAP}+` : String(count)}
			</Design.Text>
		</View>
	)
}
