import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { useState } from 'react'
import { ScrollView } from 'react-native'
import manifest from '../manifest.json'
import { DurationSlider } from './DurationSlider'
import { applied, clearHistory, useHistory } from './log'
import { DefaultSettings } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from './shared'

const icon = (name: string) => <TableRowAssetIcon name={name} />

const TEST_TEXT =
	'This is a test toast with a long message. Check that all of it shows over several lines, that it goes away after the time you chose, and that tapping it copies this whole text to the clipboard. The end of the message is this sentence.'

const SHORT_TEXT = 'Short test toast'

function showTestToast(text: string) {
	try {
		// Discord 350204 and newer: a key and options.
		ToastActionCreators.open('better-toasts-test', {
			text,
			variant: 'default',
		})
	} catch {
		// Nothing to show: the toast just does not appear.
	}
}

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>) {
	const {
		seconds: saved,
		replace,
		full,
		copy,
		byLength,
		history,
		haptic,
		pause,
		swipe,
	} = { ...DefaultSettings, ...storage.use() }
	const recent = useHistory()
	const [seconds, setSeconds] = useState(Math.max(2, saved))

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Design.Stack spacing={24}>
					<Design.TableRowGroup title="Duration">
						<Design.TableRow
							icon={icon('ClockIcon')}
							label={`Toasts stay ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`}
							subLabel="Discord keeps them 5 seconds on its own."
						/>
					</Design.TableRowGroup>
					<DurationSlider
						min={2}
						max={15}
						value={seconds}
						onChange={setSeconds}
						onCommit={value => storage.set({ seconds: value })}
					/>
					<Design.TableRowGroup title="Behavior">
						<Design.TableSwitchRow
							icon={icon('BellIcon')}
							label="New toast replaces the old one"
							subLabel="The toast on screen closes as soon as another one opens, so they never pile up."
							value={replace}
							onValueChange={replace => storage.set({ replace })}
						/>
						<Design.TableSwitchRow
							icon={icon('ClockIcon')}
							label="Longer messages stay longer"
							subLabel="Adds time for each character after the first 40, up to 10 extra seconds."
							value={byLength}
							onValueChange={byLength => storage.set({ byLength })}
						/>
						<Design.TableSwitchRow
							icon={icon('BellIcon')}
							label="Vibrate on errors"
							subLabel="A short vibration when an error toast appears."
							value={haptic}
							onValueChange={haptic => storage.set({ haptic })}
						/>
						<Design.TableSwitchRow
							icon={icon('ClipboardListIcon')}
							label="Remember recent toasts"
							subLabel="Keeps the last 30 in memory, listed below. Cleared when Discord restarts."
							value={history}
							onValueChange={history => storage.set({ history })}
						/>
					</Design.TableRowGroup>
					{(full !== applied.full ||
						copy !== applied.copy ||
						pause !== applied.pause ||
						swipe !== applied.swipe) && (
						<Design.TableRowGroup>
							<Design.TableRow
								icon={icon('WarningIcon')}
								label="Reload Discord to apply these options"
								subLabel="They are read when Discord starts. Until then the toast is drawn as before."
							/>
						</Design.TableRowGroup>
					)}
					<Design.TableRowGroup title="Changes how the toast is drawn (reload Discord after switching)">
						<Design.TableSwitchRow
							icon={icon('TextIcon')}
							label="Show the full toast"
							subLabel="Long text uses up to 8 lines instead of being cut short."
							value={full}
							onValueChange={full => storage.set({ full })}
						/>
						<Design.TableSwitchRow
							icon={icon('ClipboardListIcon')}
							label="Tap to copy"
							subLabel="Tapping a toast copies its whole message."
							value={copy}
							onValueChange={copy => storage.set({ copy })}
						/>
						<Design.TableSwitchRow
							icon={icon('ClockIcon')}
							label="Hold to pause"
							subLabel="While a finger is on the toast, its timer stops."
							value={pause}
							onValueChange={pause => storage.set({ pause })}
						/>
						<Design.TableSwitchRow
							icon={icon('XSmallIcon')}
							label="Swipe to dismiss"
							subLabel="Drag a toast away to close it."
							value={swipe}
							onValueChange={swipe => storage.set({ swipe })}
						/>
					</Design.TableRowGroup>
					{history && (
						<Design.TableRowGroup title="Recent toasts">
							{recent.length === 0 ? (
								<Design.TableRow
									label="Nothing yet"
									subLabel="Toasts show up here as they appear."
								/>
							) : (
								recent.map(item => (
									<Design.TableRow
										key={item.id}
										label={item.text}
										subLabel={`${item.time}${item.variant ? ` · ${item.variant}` : ''} · tap to copy`}
										onPress={() => void Clipboard.setString(item.text)}
									/>
								))
							)}
							{recent.length > 0 && (
								<Design.TableRow
									icon={icon('TrashIcon')}
									label="Clear the list"
									onPress={clearHistory}
								/>
							)}
						</Design.TableRowGroup>
					)}
					<Design.TableRowGroup title="Test">
						<Design.TableRow
							icon={icon('BellIcon')}
							label="Show a short test toast"
							subLabel="A few words: it stays exactly the time you chose above."
							onPress={() => showTestToast(SHORT_TEXT)}
						/>
						<Design.TableRow
							icon={icon('BellIcon')}
							label="Show a long test toast"
							subLabel="A long message, to check the full text, tap to copy, pause and swipe. It stays longer when 'Longer messages stay longer' is on."
							onPress={() => showTestToast(TEST_TEXT)}
						/>
					</Design.TableRowGroup>
					<Design.Text
						variant="text-xs/normal"
						color="text-muted"
						style={{ textAlign: 'center' }}
					>
						{`Better Toasts ${manifest.version}. Applies to toasts only, not to message banners.`}
					</Design.Text>
				</Design.Stack>
			</Page>
		</ScrollView>
	)
}
