import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import { ScrollView } from 'react-native'
import manifest from '../manifest.json'

const GUIDE: [string, string][] = [
	[
		'What it does',
		'Long-press a message and choose Delete Message: it is deleted at once, without the confirmation dialog.',
	],
	[
		'Be careful',
		'A deleted message cannot be restored. Other confirmations, such as deleting a channel or a thread, are unchanged.',
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
						{`No Delete Confirmation ${manifest.version}`}
					</Design.Text>
				</Design.Stack>
			</Page>
		</ScrollView>
	)
}
