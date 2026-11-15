import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { Component, useEffect, useReducer, useState } from 'react'
import { ScrollView } from 'react-native'
import manifest from '../manifest.json'
import {
	attribution,
	displayName,
	formatMs,
	isSlow,
	reset,
	SLOW_MS,
	shareOf,
	sorted,
	state,
	thread,
} from './monitor'
import type { ComponentProps, ReactNode } from 'react'
import type { SortKey, Stats } from './monitor'

type RowProps = Omit<ComponentProps<typeof Design.TableRow>, 'icon'> & {
	icon: string
}

const Row = ({ icon, ...props }: RowProps) => (
	<Design.TableRow
		subLabelLineClamp={4}
		{...props}
		icon={<TableRowAssetIcon name={icon} />}
	/>
)

const SITES_SHOWN = 6

const GUIDE: [string, string, string][] = [
	[
		'What is measured',
		'ClockIcon',
		'The time each plugin spends in its patches, JSX hooks, Flux event handlers and module callbacks, plus its startup. Only its own time counts: time Discord spends in the original function is left out.',
	],
	[
		'Reading the list',
		'WarningIcon',
		`A plugin is marked slow when one call takes ${SLOW_MS} ms or more, which drops a frame, or when it keeps the JS thread busy for over 1% of the time. Tap a plugin to see where its time goes.`,
	],
	[
		'Finding the culprit',
		'MagnifyingGlassIcon',
		'Reset, then use Discord the way that feels slow (scroll a chat, open a server, switch channels) and come back. To confirm, disable the slowest plugin, reload and compare.',
	],
	[
		'Developer Mode',
		'WrenchIcon',
		'With Developer Mode on in Valenced settings, startup times and plugin names are shown and more hooks are matched to their plugin. Without it, plugins show by id.',
	],
	[
		'Limits',
		'CircleInformationIcon',
		'Only time on the JavaScript thread is measured, not native rendering or network. Hooks a plugin added before this one started are not counted, so keep it enabled and reload. The monitor itself adds a very small cost to every hook.',
	],
]

function minutes(ms: number) {
	const total = Math.max(0, Math.round(ms / 60_000))
	if (total < 1) return 'less than a minute'
	if (total < 60) return `${total} min`
	return `${Math.floor(total / 60)} h ${total % 60} min`
}

/** HH:MM:SS without Intl. */
function clockTime(at: number) {
	const date = new Date(at)
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

const plural = (count: number, word: string) =>
	`${count} ${word}${count === 1 ? '' : 's'}`

function summary(entry: Stats) {
	const parts = entry.calls
		? [
				`${formatMs(entry.ms)} in ${plural(entry.calls, 'call')} (${(shareOf(entry) * 100).toFixed(2)}%)`,
				`longest ${formatMs(entry.max)}`,
			]
		: ['Hooks have not run yet']
	if (entry.slow) parts.push(`${entry.slow} over ${SLOW_MS} ms`)
	if (state.developerMode) parts.push(`startup ${formatMs(entry.startup)}`)
	parts.push(plural(entry.hooks, 'hook'))
	return parts.join(' · ')
}

function report(list: Stats[]) {
	const lines = [
		`${manifest.name} ${manifest.version}`,
		`Measured for ${minutes(Date.now() - state.since)}`,
		`JS thread stalls over 100 ms: ${thread.stallCount}, ${formatMs(thread.stalledMs)} in total`,
		`Matched by stack ${attribution.stack}, by running plugin ${attribution.context}, not identified ${attribution.unknown}`,
		'',
	]
	for (const entry of list) {
		lines.push(`${displayName(entry.id)}: ${summary(entry)}`)
		const sites = [...entry.sites.values()].sort((a, b) => b.ms - a.ms)
		for (const site of sites.slice(0, SITES_SHOWN))
			lines.push(
				`  ${site.label}: ${formatMs(site.ms)} in ${site.calls} calls, longest ${formatMs(site.max)}`,
			)
	}
	return lines.join('\n')
}

/** A plugin's row and, when open, the rows of its busiest hooks: plain rows, so the group lays them out. */
function pluginRows(entry: Stats, open: boolean, toggle: (id: string) => void) {
	const rows = [
		<Row
			key={entry.id}
			icon={isSlow(entry) ? 'WarningIcon' : 'CircleCheckIcon'}
			label={displayName(entry.id)}
			subLabel={summary(entry)}
			onPress={() => toggle(entry.id)}
		/>,
	]
	if (!open) return rows
	const sites = [...entry.sites.values()]
		.sort((a, b) => b.ms - a.ms)
		.slice(0, SITES_SHOWN)
	for (const site of sites)
		rows.push(
			<Row
				key={`${entry.id}|${site.label}`}
				icon="ArrowSmallRightIcon"
				label={site.label}
				subLabel={`${formatMs(site.ms)} in ${plural(site.calls, 'call')} · longest ${formatMs(site.max)}${site.slow ? ` · ${site.slow} over ${SLOW_MS} ms` : ''}`}
			/>,
		)
	if (!sites.length)
		rows.push(
			<Row
				key={`${entry.id}|none`}
				icon="ArrowSmallRightIcon"
				label="No hook calls yet"
				subLabel="Its hooks have not run since the last reset."
			/>,
		)
	return rows
}

/** Shows what went wrong instead of a page that does not open. */
class Guard extends Component<{ children: ReactNode }, { error?: unknown }> {
	state: { error?: unknown } = {}
	static getDerivedStateFromError(error: unknown) {
		return { error }
	}
	render() {
		const { error } = this.state
		if (error === undefined) return this.props.children
		const text =
			error instanceof Error
				? `${error.message}
${error.stack ?? ''}`
				: String(error)
		return (
			<ScrollView>
				<Page>
					<Design.Stack spacing={12}>
						<Design.Text variant="heading-md/bold">
							The page could not be shown
						</Design.Text>
						<Design.Text variant="text-sm/normal" selectable>
							{text.slice(0, 2000)}
						</Design.Text>
						<Design.Button
							text="Copy error"
							onPress={() => void Clipboard.setString(text)}
						/>
						<Design.Button
							text="Reset and try again"
							variant="secondary"
							onPress={() => {
								reset()
								this.setState({ error: undefined })
							}}
						/>
					</Design.Stack>
				</Page>
			</ScrollView>
		)
	}
}

export default function SettingsComponent() {
	return (
		<Guard>
			<SettingsPage />
		</Guard>
	)
}

function SettingsPage() {
	const [, rerender] = useReducer((value: number) => value + 1, 0)
	const [sortBy, setSortBy] = useState<SortKey>('total')
	const [open, setOpen] = useState<string | null>(null)
	const toggle = (id: string) => setOpen(value => (value === id ? null : id))

	// The numbers change all the time, so the page refreshes while it is open.
	useEffect(() => {
		const timer = setInterval(rerender, 1000)
		return () => clearInterval(timer)
	}, [])

	const list = sorted(sortBy)
	const pluginMs = list.reduce((sum, entry) => sum + entry.ms, 0)
	const elapsed = Math.max(1, Date.now() - state.since)
	const slowCount = list.filter(isSlow).length
	const longest = thread.stalls[0]

	return (
		<ScrollView>
			<Page>
				<Design.Stack spacing={24}>
					<Design.TableRowGroup title="Overview">
						{state.startedLate && (
							<Row
								icon="WarningIcon"
								label="Reload Discord to measure every plugin"
								subLabel="The monitor started after the other plugins, so the hooks they already added are not counted."
							/>
						)}
						<Row
							icon="ClockIcon"
							label={`Measuring for ${minutes(Date.now() - state.since)}`}
							subLabel={`Plugins used ${formatMs(pluginMs)} of JS thread time (${((pluginMs / elapsed) * 100).toFixed(2)}%). ${slowCount ? `${slowCount} marked slow.` : 'None marked slow.'}`}
						/>
						<Row
							icon={thread.stallCount ? 'WarningIcon' : 'CircleCheckIcon'}
							label="JS thread stalls"
							subLabel={
								thread.stallCount
									? `${thread.stallCount} times busy for over 100 ms, ${formatMs(thread.stalledMs)} in total. Longest ${formatMs(longest?.ms ?? 0)} at ${clockTime(longest?.at ?? 0)}. Includes Discord itself.`
									: 'No stalls over 100 ms. Includes Discord itself.'
							}
						/>
						<Row
							icon={state.developerMode ? 'CircleCheckIcon' : 'WrenchIcon'}
							label={
								state.developerMode ? 'Developer Mode on' : 'Developer Mode off'
							}
							subLabel={
								state.developerMode
									? 'Startup times and plugin names are shown.'
									: 'Turn it on in Valenced settings and reload for startup times and plugin names.'
							}
						/>
						<Row
							icon="RefreshIcon"
							label="Reset"
							subLabel="Start counting again from now. Startup times are kept."
							onPress={() => {
								reset()
								rerender()
							}}
						/>
						<Row
							icon="CopyIcon"
							label="Copy report"
							onPress={() => {
								void Clipboard.setString(report(list))
								ToastActionCreators.open('dariuss.performance-monitor.copied', {
									text: 'Report copied',
								})
							}}
						/>
					</Design.TableRowGroup>
					<Design.TableRadioGroup
						title="Sort plugins by"
						value={sortBy}
						onChange={(value: SortKey) => setSortBy(value)}
					>
						<Design.TableRadioRow
							label="Total time"
							value="total"
							subLabel="Time spent in hooks since the last reset."
						/>
						<Design.TableRadioRow
							label="Longest call"
							value="longest"
							subLabel="The single slowest hook call, the cause of stutters."
						/>
						<Design.TableRadioRow
							label="Startup"
							value="startup"
							subLabel="Time spent while Discord opens. Needs Developer Mode."
						/>
					</Design.TableRadioGroup>
					<Design.TableRowGroup title="Plugins">
						{list.length ? (
							list.flatMap(entry =>
								pluginRows(entry, open === entry.id, toggle),
							)
						) : (
							<Row
								icon="CircleInformationIcon"
								label="Nothing measured yet"
								subLabel="Reload Discord with this plugin enabled, then use the app for a while."
							/>
						)}
					</Design.TableRowGroup>
					<Design.TableRowGroup title="Quick guide">
						{GUIDE.map(([label, icon, subLabel]) => (
							<Row key={label} icon={icon} label={label} subLabel={subLabel} />
						))}
					</Design.TableRowGroup>
					<Design.Stack align="center">
						<Design.Text variant="text-xs/normal" color="text-muted">
							{`${manifest.name} ${manifest.version}`}
						</Design.Text>
					</Design.Stack>
				</Design.Stack>
			</Page>
		</ScrollView>
	)
}
