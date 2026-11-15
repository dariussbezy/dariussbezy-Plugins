import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import { ScrollView } from 'react-native'
import manifest from '../manifest.json'

const GUIDE: [string, string][] = [
	[
		'What it does',
		'Tapping the name above a message no longer inserts a mention into the text box.',
	],
	[
		'Turning it off',
		'Disable the plugin to get Discord’s normal behavior back. Rows already on screen return to normal at once.',
	],
]

export default function SettingsComponent() {
	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Design.Stack spacing={24}>
					<Design.TableRowGroup title="Quick guide">
						{GUIDE.map(([label, subLabel]) => (
							<Design.TableRow
								key={label}
								icon={<TableRowAssetIcon name="CircleInformationIcon" />}
								label={label}
								subLabel={subLabel}
								subLabelLineClamp={4}
							/>
						))}
					</Design.TableRowGroup>
					<Design.Text
						variant="text-xs/normal"
						color="text-muted"
						style={{ textAlign: 'center' }}
					>
						{`No Tap Mention ${manifest.version}`}
					</Design.Text>
				</Design.Stack>
			</Page>
		</ScrollView>
	)
}
