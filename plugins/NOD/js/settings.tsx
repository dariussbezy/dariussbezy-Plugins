import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import { ScrollView } from 'react-native'
import { StatsRow } from '../../../lib/stats-ui'
import manifest from '../manifest.json'

const GUIDE: [string, string][] = [
	[
		'What it does',
		'Server onboarding makes you wait: timers run for seconds before you can continue. While an onboarding screen is open, those waits are skipped.',
	],
	[
		'How to use it',
		'Nothing to set. Join a server that has onboarding turned on and open it: the steps appear without the long waits.',
	],
	[
		'Good to know',
		'Only waits of a fraction of a second to five seconds, set right after an onboarding screen shows, are skipped. The start animation of the onboarding can still play. Everything else in Discord keeps its normal timing.',
	],
]

export default function SettingsComponent() {
	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Design.Stack spacing={24}>
					<StatsRow />
					<Design.TableRowGroup title="Quick guide">
						{GUIDE.map(([label, subLabel]) => (
							<Design.TableRow
								key={label}
								icon={<TableRowAssetIcon name="CircleInformationIcon" />}
								label={label}
								subLabel={subLabel}
								subLabelLineClamp={6}
							/>
						))}
					</Design.TableRowGroup>
					<Design.Text
						variant="text-xs/normal"
						color="text-muted"
						style={{ textAlign: 'center' }}
					>
						{`No Onboarding Delay ${manifest.version}`}
					</Design.Text>
				</Design.Stack>
			</Page>
		</ScrollView>
	)
}
