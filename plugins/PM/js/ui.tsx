import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import type { ComponentProps } from 'react'

type RowProps = Omit<ComponentProps<typeof Design.TableRow>, 'icon'> & {
	icon: string
}

export const Row = ({ icon, ...props }: RowProps) => (
	<Design.TableRow
		subLabelLineClamp={4}
		{...props}
		icon={<TableRowAssetIcon name={icon} />}
	/>
)

export function minutes(ms: number) {
	const total = Math.max(0, Math.round(ms / 60_000))
	if (total < 1) return 'less than a minute'
	if (total < 60) return `${total} min`
	return `${Math.floor(total / 60)} h ${total % 60} min`
}

/** HH:MM:SS without Intl. */
export function clockTime(at: number) {
	const date = new Date(at)
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export const plural = (count: number, word: string) =>
	`${count} ${word}${count === 1 ? '' : 's'}`
