import { cloneElement, isValidElement } from 'react'
import { isSection } from './shared'
import type { ReactElement, ReactNode } from 'react'

type RowProps = { label?: unknown; onPress?: unknown }
type GroupProps = { children?: ReactNode; hasIcons?: boolean }

const flat = (children: ReactNode) =>
	[children].flat(Number.POSITIVE_INFINITY) as ReactNode[]

const isRow = (node: ReactNode): node is ReactElement<RowProps> =>
	isValidElement<RowProps>(node) &&
	typeof node.props.label === 'string' &&
	typeof node.props.onPress === 'function'

/** A group that only holds plain action rows, which is what can be reordered. */
function rowsOf(group: ReactNode) {
	if (!isValidElement<GroupProps>(group)) return null
	const children = flat(group.props.children).filter(child => child != null)
	return children.length && children.every(isRow)
		? (children as ReactElement<RowProps>[])
		: null
}

const labelOf = (row: ReactElement<RowProps>) => row.props.label as string

/** Labels of the sheet's action rows, section by section. */
export function sectionsOf(groups: ReactNode): string[][] {
	return flat(groups).flatMap(group => {
		const rows = rowsOf(group)
		return rows ? [rows.map(labelOf)] : []
	})
}

/**
 * Lays the action rows out in the chosen order and sections, without the hidden ones.
 * Rows not in the order yet go to the end of the last section; groups that hold anything
 * other than action rows are kept below, untouched.
 */
export function arrange(
	groups: ReactNode,
	order: readonly string[],
	hidden: ReadonlySet<string>,
): ReactNode {
	const rows = new Map<string, ReactElement<RowProps>>()
	const kept: ReactNode[] = []
	let template: ReactElement<GroupProps> | undefined
	for (const group of flat(groups)) {
		const groupRows = rowsOf(group)
		if (!groupRows) {
			if (group != null) kept.push(group)
			continue
		}
		template ??= group as ReactElement<GroupProps>
		for (const row of groupRows)
			if (!rows.has(labelOf(row))) rows.set(labelOf(row), row)
	}
	if (!template) return groups

	const sections: ReactElement<RowProps>[][] = [[]]
	for (const token of order) {
		if (isSection(token)) {
			sections.push([])
			continue
		}
		const row = rows.get(token)
		if (!row) continue
		rows.delete(token)
		if (!hidden.has(token)) sections[sections.length - 1].push(row)
	}
	for (const [label, row] of rows)
		if (!hidden.has(label)) sections[sections.length - 1].push(row)

	const base = template
	return [
		...sections
			.filter(section => section.length)
			.map(section =>
				cloneElement(base, {
					key: `dariuss-message-actions-${labelOf(section[0])}`,
					children: section.map(row =>
						cloneElement(row, { key: labelOf(row) }),
					),
				}),
			),
		...kept,
	]
}

export interface IconInfo {
	/** Discord's icon component, only known while Discord runs. */
	component?: unknown
	/** Asset name, kept across restarts. */
	name?: string
	/** Asset id, for rows that draw an image instead of an icon component. */
	id?: number
}

/** The icon of each action row, by label. */
export function iconsOf(groups: ReactNode) {
	const icons = new Map<string, IconInfo>()
	for (const group of flat(groups))
		for (const row of rowsOf(group) ?? []) {
			const icon = (row.props as { icon?: unknown }).icon
			if (!isValidElement<{ IconComponent?: unknown; source?: unknown }>(icon))
				continue
			const { IconComponent, source } = icon.props
			const named = IconComponent as
				| { displayName?: string; name?: string }
				| undefined
			const name = named?.displayName ?? named?.name
			icons.set(labelOf(row), {
				component: IconComponent,
				name: name && /Icon$/.test(name) ? name : undefined,
				id: typeof source === 'number' ? source : undefined,
			})
		}
	return icons
}
