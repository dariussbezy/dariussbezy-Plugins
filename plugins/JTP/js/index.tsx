import { getAssetIdByName } from '@valenced/assets'
import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { onFluxEventDispatched, Stores } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
} from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { useReRender } from '@valenced/utils/react'
import { cloneElement, useEffect } from 'react'
import { View } from 'react-native'
import { CountBadge } from './badge'
import { cancelNavigation, SHEET_KEY } from './navigation'
import { capture, drop, getRows, openRow, resetPings, totalOf } from './pings'
import SettingsComponent from './settings'
import {
	bindStorage,
	cancelNotify,
	DefaultSettings,
	getSettings,
	listeners,
	notify,
} from './shared'
import { openPingSheet, toast } from './sheet'
import type { Design } from '@valenced/discord/design'
import type { Filter, FilterGenerator } from '@valenced/modules/finders/filters'
import type {
	ComponentProps,
	ComponentType,
	FC,
	MemoExoticComponent,
	ReactElement,
	ReactNode,
} from 'react'
import type { Settings } from './shared'

const ICON_NAMES = ['AtIcon', 'MentionIcon', 'ChatMarkUnreadIcon', 'BellIcon']

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	start({ cleanup, jsonStorage, logger, plugin }) {
		// The profile bar button can only be patched before it first renders.
		if (plugin.startedLate) {
			plugin.requireReload()
			return
		}

		bindStorage(jsonStorage)
		const guarded =
			<T,>(handler: (payload: T) => void) =>
			(payload: T) => {
				try {
					handler(payload)
				} catch (error) {
					logger.error('Jump to Ping handler failed:', error)
				}
				return payload
			}
		const readStates = Stores.ReadStateStore as unknown as
			| {
					addChangeListener(cb: () => void): void
					removeChangeListener(cb: () => void): void
			  }
			| undefined
		readStates?.addChangeListener(notify)

		cleanup(
			() => {
				readStates?.removeChangeListener(notify)
				cancelNotify()
				cancelNavigation()
				ActionSheetActionCreators.hideActionSheet(SHEET_KEY)
				resetPings()
				listeners.clear()
				bindStorage(undefined)
			},
			jsonStorage.subscribe(notify),
			onFluxEventDispatched<{
				channelId?: string
				message?: Parameters<typeof capture>[1]
				optimistic?: boolean
			}>(
				'MESSAGE_CREATE',
				guarded(payload => {
					if (!payload.optimistic) capture(payload.channelId, payload.message)
				}),
			),
			onFluxEventDispatched<{ channelId?: string; id: string }>(
				'MESSAGE_DELETE',
				guarded(payload => drop(payload.channelId, payload.id)),
			),
			onFluxEventDispatched<{ channelId?: string; ids: string[] }>(
				'MESSAGE_DELETE_BULK',
				guarded(payload => {
					for (const id of payload.ids) drop(payload.channelId, id)
				}),
			),
			getModules(
				withMemoizedComponentName('YouBarNotificationsButton'),
				YouBarNotificationsButton => {
					if (!YouBarNotificationsButton?.type) return
					cleanup(
						instead(YouBarNotificationsButton, 'type', (args, orig) =>
							useYouBarButton(args, orig, error =>
								logger.error('Jump to Ping failed:', error),
							),
						),
					)
				},
			),
		)
	},
	stop({ plugin }) {
		plugin.requireReload()
	},
	SettingsComponent,
})

function useYouBarButton(
	args: Parameters<FC>,
	orig: FC,
	onError: (error: unknown) => void,
) {
	const rerender = useReRender()

	useEffect(() => {
		listeners.add(rerender)
		return () => {
			listeners.delete(rerender)
		}
	}, [rerender])

	const res = orig(...args) as YouBarButtonElement
	if (!res?.props?.children) return res

	const rows = getRows()
	const { hideWhenEmpty, showBadge } = getSettings()
	if (!rows.length && hideWhenEmpty) return res

	const icon = ICON_NAMES.map(name => getAssetIdByName(name)).find(
		id => id != null,
	)
	if (icon == null) return res

	const Container = res.type
	const total = totalOf(rows)

	return (
		<>
			<Container key="jump-to-ping">
				{/* custom: Discord has no native badge component to overlay on an icon button */}
				<View>
					{/* The bell's own button, so the icon is colored exactly like it in every theme. */}
					{cloneElement(res.props.children, {
						accessibilityLabel: 'Pings',
						accessibilityHint: 'Long press to jump to the newest ping',
						icon,
						onPress: openPingSheet,
						onLongPress: () => {
							const newest = getRows()[0]
							if (!newest) return toast('No unread pings')
							openRow(newest, onError).catch(() =>
								toast('Could not open this ping'),
							)
						},
					})}
					{showBadge && total > 0 && <CountBadge count={total} floating />}
				</View>
			</Container>
			{res}
		</>
	)
}

type WithMemoizedComponentName = FilterGenerator<
	<P = object>(
		name: string,
	) => Filter<{
		Result: MemoExoticComponent<FC<P>>
		Scopes: [typeof FilterScopes.Initialized]
	}>
>

const withMemoizedComponentName = createFilterGenerator(
	([name], _, exports) => exports?.type?.name === name,
	([name]) => `memoizedComponentName(${name})`,
	FilterScopes.Initialized,
) as WithMemoizedComponentName

type IconButtonProps = ComponentProps<typeof Design.IconButton>

type YouBarButtonElement = ReactElement<
	{ children?: ReactElement<IconButtonProps> },
	ComponentType<{ children?: ReactNode }>
>
