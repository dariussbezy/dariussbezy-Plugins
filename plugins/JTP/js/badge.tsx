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
				...(floating
					? { position: 'absolute', top: 4, right: 4, zIndex: 1 }
					: {}),
				minWidth: 16,
				height: 16,
				borderRadius: 8,
				paddingHorizontal: 4,
				alignItems: 'center',
				justifyContent: 'center',
				backgroundColor: background,
			}}
		>
			<Design.Text
				variant="text-xs/bold"
				style={{
					color: '#FFFFFF',
					fontSize: 11,
					lineHeight: 14,
					includeFontPadding: false,
				}}
			>
				{count > CAP ? `${CAP}+` : String(count)}
			</Design.Text>
		</View>
	)
}
