import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { useEffect, useState } from 'react'
import {
	breakdown,
	calibrate,
	culprits,
	displayName,
	elapsedMs,
	flux,
	formatMs,
	frames,
	hookedFunctions,
	hookKinds,
	monitorCostMs,
	overhead,
	state,
	thread,
} from './monitor'
import {
	ACTIVITIES,
	compareRuns,
	createRun,
	describeRun,
	MAX_RUNS,
} from './runs'
import { clockTime, plural, Row } from './ui'
import type { AiStorage } from './review'

const percent = (part: number, whole: number, digits = 0) =>
	whole > 0 ? `${((part / whole) * 100).toFixed(digits)}%` : '0%'

const NAME = (id: string) => displayName(id)

/** Where the stalled time went: plugin hooks, Discord's Flux, or something that is not measured. */
export function StallAnalysis() {
	if (!breakdown.count) return null
	const total = breakdown.ms
	const mostlyOther = breakdown.otherMs / total >= 0.6
	const leaders = [...culprits.entries()]
		.filter(([, item]) => item.stalls > 0 || item.ms >= 20)
		.sort((a, b) => b[1].stalls - a[1].stalls || b[1].ms - a[1].ms)
		.slice(0, 5)
	return (
		<Design.TableRowGroup title="Stall analysis">
			<Row
				icon="MagnifyingGlassIcon"
				label="Where the stalled time went"
				subLabel={[
					`${formatMs(total)} stalled in ${plural(breakdown.count, 'stall')}: plugin hooks ${percent(breakdown.hookMs, total)}, Discord's Flux handling ${percent(breakdown.fluxMs, total)}, not measured ${percent(breakdown.otherMs, total)}.`,
					'Not measured means React rendering, timers, native events and garbage collection.',
					mostlyOther
						? 'Most of the stalled time is not in plugin hooks, so plugins are probably not the main cause.'
						: '',
					flux.calls
						? ''
						: "Discord's Flux time could not be measured on this build.",
				]
					.filter(Boolean)
					.join(' ')}
			/>
			{leaders.map(([id, item]) => (
				<Row
					key={id}
					icon="WarningIcon"
					label={NAME(id)}
					subLabel={`Led ${item.stalls} of ${plural(breakdown.count, 'stall')} · ${formatMs(item.ms)} of hook time inside stalls`}
				/>
			))}
			{thread.stalls.map(stall => (
				<Row
					key={stall.at}
					icon="ClockIcon"
					label={`${clockTime(stall.at)} · stalled ${formatMs(stall.ms)}`}
					subLabel={[
						`Plugin hooks ${formatMs(stall.hookMs)}, Flux ${formatMs(stall.fluxMs)}, not measured ${formatMs(stall.otherMs)}.`,
						stall.top.length
							? `Busiest: ${stall.top.map(item => `${NAME(item.id)} ${formatMs(item.ms)}`).join(', ')}.`
							: 'No plugin hook ran.',
						stall.slowest
							? `Slowest call: ${NAME(stall.slowest.id)}, ${stall.slowest.label}, ${formatMs(stall.slowest.ms)}.`
							: '',
						stall.topHook
							? `Heaviest hook in total: ${NAME(stall.topHook.id)}, ${stall.topHook.label}, ${formatMs(stall.topHook.ms)}.`
							: '',
					]
						.filter(Boolean)
						.join(' ')}
				/>
			))}
		</Design.TableRowGroup>
	)
}

/** Time per hooked function and per hook kind, all plugins together: shows where hooks pile up. */
export function HookedFunctions() {
	const kinds = hookKinds()
	if (!kinds.length) return null
	const functions = hookedFunctions().slice(0, 8)
	return (
		<Design.TableRowGroup title="Hooked functions (all plugins together)">
			{kinds.map(kind => (
				<Row
					key={kind.label}
					icon="ClipboardListIcon"
					label={kind.label}
					subLabel={`${formatMs(kind.ms)} across ${plural(kind.plugins, 'plugin')} · ${plural(kind.calls, 'call')}`}
				/>
			))}
			{functions.map(item => (
				<Row
					key={item.label}
					icon="ArrowSmallRightIcon"
					label={item.label}
					subLabel={`${formatMs(item.ms)} across ${plural(item.plugins, 'plugin')} · ${plural(item.calls, 'call')} · longest ${formatMs(item.max)}`}
				/>
			))}
		</Design.TableRowGroup>
	)
}

let calibratedLong = false

/** The monitor's own cost, the light mode switch and JS frame pacing. */
export function Measuring({ storage }: { storage?: AiStorage }) {
	// A longer calibration than the one at start, once, so the estimate does not rest on a few thousand calls.
	useEffect(() => {
		if (calibratedLong) return
		const timer = setTimeout(() => {
			calibratedLong = true
			calibrate(30000)
		}, 1500)
		return () => clearTimeout(timer)
	}, [])
	const cost = monitorCostMs()
	const elapsed = elapsedMs()
	const light = state.sampleEvery > 1
	return (
		<Design.TableRowGroup title="Measuring">
			<Row
				icon="ClockIcon"
				label="The monitor's own cost"
				subLabel={`About ${formatMs(cost)} (${percent(cost, elapsed, 2)} of the measured time), roughly ${(overhead.perCallMs * 1000).toFixed(1)} µs per timed call. Estimated, not measured directly.`}
			/>
			{storage && (
				<Design.TableSwitchRow
					label="Light mode"
					subLabel="Times only one call in ten, which lowers the monitor's own cost. Totals become estimates; the longest call is still exact."
					value={light}
					onValueChange={(value: boolean) => {
						state.sampleEvery = value ? 10 : 1
						void storage.set({ lightMode: value })
					}}
				/>
			)}
			<Row
				icon="TimerIcon"
				label="JS frames"
				subLabel={
					frames.total
						? `${frames.dropped} late out of ${frames.total} frames (${percent(frames.dropped, frames.total, 1)}), worst gap ${formatMs(frames.worstMs)}. Counted while this page is open, on the JS side only: the UI thread, Reanimated and per-gesture timing cannot be seen by a plugin.`
						: 'Counting JS frames while this page is open. Only the JS side is visible: the UI thread and Reanimated cannot be seen by a plugin.'
				}
			/>
		</Design.TableRowGroup>
	)
}

/** Saved runs to compare: for example with all other plugins off (a baseline) against with them on. */
export function Runs({ storage }: { storage: AiStorage }) {
	const saved = storage.use()
	const runs = saved?.runs ?? []
	const activity = saved?.activity ?? 'other'
	const [picked, setPicked] = useState<string[]>([])
	const toggle = (id: string) =>
		setPicked(current =>
			current.includes(id)
				? current.filter(item => item !== id)
				: [...current, id].slice(-2),
		)
	const chosen = runs.filter(run => picked.includes(run.id))
	const text =
		chosen.length === 2
			? compareRuns(
					...(chosen.sort((a, b) => a.at - b.at) as [
						(typeof chosen)[0],
						(typeof chosen)[0],
					]),
				).join('\n')
			: ''
	return (
		<>
			<Design.TableRadioGroup
				title="Activity during this run"
				description="Saved with the run, so runs of the same activity can be compared."
				value={activity}
				onChange={(value: string) => void storage.set({ activity: value })}
			>
				{ACTIVITIES.map(([id, label]) => (
					<Design.TableRadioRow key={id} label={label} value={id} />
				))}
			</Design.TableRadioGroup>
			<Design.TableRowGroup title="Saved runs">
				<Row
					icon="PlusSmallIcon"
					label="Save this run"
					subLabel="Keeps the numbers since the last reset. For a baseline, turn the other plugins off, reload, use Discord the same way, and save. Then compare it with a run with them on."
					onPress={() => {
						if (elapsedMs() < 15_000) {
							ToastActionCreators.open('dariuss.performance-monitor.run', {
								text: 'Measure for a little longer first',
							})
							return
						}
						void storage.set({
							runs: [createRun(activity), ...runs].slice(0, MAX_RUNS),
						})
					}}
				/>
				{runs.map(run => (
					<Row
						key={run.id}
						icon={
							picked.includes(run.id)
								? 'CircleCheckIcon'
								: 'CircleInformationIcon'
						}
						label={describeRun(run)}
						subLabel={`${run.stalls.count} stalls (${formatMs(run.stalls.ms)}), plugin hooks ${run.hookPercent}% of the time. Tap to pick two runs to compare.`}
						onPress={() => toggle(run.id)}
					/>
				))}
				{chosen.length === 2 && (
					<Row
						icon="CopyIcon"
						label="Copy comparison"
						subLabel={text}
						subLabelLineClamp={30}
						onPress={() => {
							void Clipboard.setString(text)
							ToastActionCreators.open('dariuss.performance-monitor.run', {
								text: 'Comparison copied',
							})
						}}
					/>
				)}
				{chosen.length > 0 && (
					<Row
						icon="TrashIcon"
						label={`Delete ${plural(chosen.length, 'picked run')}`}
						onPress={() => {
							void storage.set({
								runs: runs.filter(run => !picked.includes(run.id)),
							})
							setPicked([])
						}}
					/>
				)}
			</Design.TableRowGroup>
		</>
	)
}
