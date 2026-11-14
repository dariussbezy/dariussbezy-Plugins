/**
 * A small Discord-flavoured markdown parser that produces the same node shapes Discord's chat rows use.
 * Used for old message versions when Discord's own parser leaves the source text raw.
 */
export type Node = { type: string; content?: unknown; level?: number }

const text = (content: string): Node => ({ type: 'text', content })
const isWord = (char: string | undefined) =>
	!!char && /[\p{L}\p{N}]/u.test(char)
const isSpace = (char: string | undefined) => !char || /\s/.test(char)

const PAIRS = [
	{ open: '***', type: 'strong-em' },
	{ open: '**', type: 'strong' },
	{ open: '__', type: 'u' },
	{ open: '~~', type: 's' },
	{ open: '||', type: 'spoiler' },
	{ open: '*', type: 'em' },
	{ open: '_', type: 'em' },
] as const

function inline(source: string): Node[] {
	const out: Node[] = []
	let buffer = ''
	const flush = () => {
		if (buffer) out.push(text(buffer))
		buffer = ''
	}
	let i = 0
	while (i < source.length) {
		const char = source[i]
		if (char === '\\' && i + 1 < source.length) {
			buffer += source[i + 1]
			i += 2
			continue
		}
		if (char === '`') {
			const end = source.indexOf('`', i + 1)
			if (end > i + 1) {
				flush()
				out.push({ type: 'inlineCode', content: source.slice(i + 1, end) })
				i = end + 1
				continue
			}
		}
		const pair = PAIRS.find(({ open }) => source.startsWith(open, i))
		if (pair) {
			const from = i + pair.open.length
			const end = source.indexOf(pair.open, from)
			const underscore = pair.open.startsWith('_')
			if (
				end > from &&
				!isSpace(source[from]) &&
				!isSpace(source[end - 1]) &&
				!(
					underscore &&
					(isWord(source[i - 1]) || isWord(source[end + pair.open.length]))
				)
			) {
				flush()
				const content = inline(source.slice(from, end))
				out.push(
					pair.type === 'strong-em'
						? { type: 'strong', content: [{ type: 'em', content }] }
						: { type: pair.type, content },
				)
				i = end + pair.open.length
				continue
			}
		}
		buffer += char
		i++
	}
	flush()
	return out
}

/** Parses a message into nodes: subtext (`-# `), headings, bold, italic, underline, strikethrough, spoilers and inline code. */
export function parseMarkdown(source: string): Node[] {
	const out: Node[] = []
	let block = false
	source.split('\n').forEach((line, index) => {
		// A subtext or heading already ends its own line.
		if (index && !block) out.push(text('\n'))
		block = false
		const subtext = /^-# (.+)$/.exec(line)
		if (subtext) {
			block = true
			out.push({ type: 'subtext', content: inline(subtext[1]) })
			return
		}
		const heading = /^(#{1,3}) (.+)$/.exec(line)
		if (heading) {
			block = true
			out.push({
				type: 'heading',
				level: heading[1].length,
				content: inline(heading[2]),
			})
			return
		}
		out.push(...inline(line))
	})
	return out
}

/** The text of nodes with all formatting removed. */
export function plainText(nodes: readonly Node[]): string {
	return nodes
		.map(node =>
			typeof node.content === 'string'
				? node.content
				: Array.isArray(node.content)
					? plainText(node.content as Node[])
					: '',
		)
		.join('')
}

export const isFormatted = (nodes: readonly Node[]) =>
	nodes.some(node => node.type !== 'text')
