import { TableRowAssetIcon } from '@valenced/components'
import Page from '@valenced/components/Page'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { createContext, useContext, useMemo, useState } from 'react'
import { sendStats, startStats } from './stats'
import type { ComponentType, Context } from 'react'
import type { StatsSource } from './stats'

type Manifest = { id: string; version: string }
type Storage = { cache?: unknown }

/** Statistics for a plugin; its settings are read from its jsonStorage when it has one. */
export const startStatsFor = (manifest: Manifest, storage?: Storage) =>
	startStats({ manifest, settings: () => storage?.cache })

/** A row that sends the statistics report right away and says whether it went through. */
export function StatsButton(source: StatsSource) {
	const [sending, setSending] = useState(false)
	return (
		<Design.TableRowGroup>
			<Design.TableRow
				icon={<TableRowAssetIcon name="AnalyticsIcon" />}
				label="Send statistics now"
				subLabel="Sends your plugin version, device and settings to the developer right away."
				disabled={sending}
				onPress={async () => {
					setSending(true)
					const sent = await sendStats(source)
					setSending(false)
					ToastActionCreators.open(`${source.manifest.id}.stats`, {
						text: sent
							? 'Statistics sent.'
							: 'Statistics could not be sent. Check your connection.',
					})
				}}
			/>
		</Design.TableRowGroup>
	)
}

type SettingsProps = { api?: { jsonStorage?: Storage } }

// Created on first use: some plugins load before React does.
let context: Context<StatsSource | null> | undefined
const statsContext = () => {
	context ??= createContext<StatsSource | null>(null)
	return context
}

/** The "Send statistics now" row; put it last in a settings page wrapped by withStats. */
export function StatsRow() {
	const source = useContext(statsContext())
	return source ? <StatsButton {...source} /> : null
}

/** Gives the plugin's settings page what StatsRow needs to send a report. */
export function withStats<P extends object>(
	manifest: Manifest,
	Inner?: ComponentType<P>,
) {
	// Typed loosely: each plugin passes its own settings props.
	return function SettingsWithStats(props: P) {
		const storage = (props as SettingsProps).api?.jsonStorage
		const source = useMemo(
			() => ({ manifest, settings: () => storage?.cache }),
			[storage],
		)
		const Provider = statsContext().Provider
		if (!Inner)
			return (
				<Page>
					<StatsButton {...source} />
				</Page>
			)
		return (
			<Provider value={source}>
				<Inner {...props} />
			</Provider>
		)
	} as never
}
