import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { getNativeModule } from '@valenced/modules/native'
import { instead } from '@valenced/patcher'
import { cloneElement, isValidElement } from 'react'
import { downloadAll, downloadable } from './download'
import { placeGroup } from './menu-order'
import type { ReactElement, ReactNode } from 'react'
import type { MediaManager, Message } from './download'

const LongPressKey = 'MessageLongPressActionSheet'

type Sheet = (props: object) => ReactNode
type Element = ReactElement<{ children?: ReactNode }>

interface SheetOpener {
	openLazy(
		sheet: Promise<{ default: Sheet }>,
		key: string,
		props: { message?: Message },
		...rest: unknown[]
	): void
}

/** Adds the group to the first ActionSheet found in the tree. */
function addGroup(tree: ReactNode, group: ReactElement): ReactNode {
	let done = false
	const walk = (node: ReactNode): ReactNode => {
		if (done) return node
		if (Array.isArray(node)) return node.map(walk)
		if (!isValidElement(node)) return node
		const element = node as Element
		if (element.type === Design.ActionSheet) {
			done = true
			return cloneElement(element, {
				children: placeGroup(element.props.children, group) ?? [
					element.props.children,
					group,
				],
			})
		}
		const children = walk(element.props.children)
		return done ? cloneElement(element, { children }) : node
	}
	return walk(tree)
}

export default plugin({
	start({ cleanup, logger }) {
		let manager: MediaManager | undefined
		let native: MediaManager | undefined
		// The native media manager saves any file type; a JS module exposing it is only a fallback.
		const resolveManager = () => {
			if (native) return native
			try {
				native =
					getNativeModule<MediaManager>('NativeMediaManagerModule') ?? undefined
			} catch (error) {
				logger.error('Native media manager not found:', error)
			}
			return native ?? manager
		}
		cleanup(
			getModules(
				withProps<MediaManager>('downloadMediaAsset'),
				module => {
					manager = module
				},
				{ max: 1 },
			),
			instead(
				ActionSheetActionCreators as unknown as SheetOpener,
				'openLazy',
				function (args, original) {
					const [sheet, key, props] = args
					const attachments = downloadable(props?.message)
					if (key !== LongPressKey || !sheet?.then || !attachments.length)
						return Reflect.apply(original, this, args)

					const wrapped = sheet.then(module => {
						const Original = module.default
						if (typeof Original !== 'function') return module
						return {
							...module,
							default: function BulkDownloadsActions(sheetProps: object) {
								const tree = Original(sheetProps)
								try {
									return addGroup(
										tree,
										<Design.ActionSheetRow.Group key="bd-menu">
											<Design.ActionSheetRow
												label={
													attachments.length === 1
														? 'Download'
														: `Download all (${attachments.length})`
												}
												icon={<TableRowAssetIcon name="DownloadIcon" />}
												onPress={() => {
													ActionSheetActionCreators.hideActionSheet(key)
													void downloadAll(
														resolveManager(),
														attachments,
														error => logger.error('Download failed:', error),
													)
												}}
											/>
										</Design.ActionSheetRow.Group>,
									)
								} catch (error) {
									logger.error('Bulk Downloads failed:', error)
									return tree
								}
							},
						}
					})
					return Reflect.apply(original, this, [wrapped, ...args.slice(1)])
				},
			),
		)
	},
})
