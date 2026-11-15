export type Piece = { kind: 'same' | 'removed' | 'added'; text: string }

const tokens = (text: string) => text.match(/\s+|[^\s]+/g) ?? []

/** A word-level difference between two versions of a text, found with the longest common subsequence. */
export function diffWords(before: string, after: string): Piece[] {
	const a = tokens(before)
	const b = tokens(after)
	// Tables for very long messages would be large; those fall back to a plain before/after.
	if (a.length * b.length > 250000)
		return [
			...(before ? [{ kind: 'removed' as const, text: before }] : []),
			...(after ? [{ kind: 'added' as const, text: after }] : []),
		]
	const width = b.length + 1
	const table = new Uint16Array((a.length + 1) * width)
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			table[i * width + j] =
				a[i] === b[j]
					? table[(i + 1) * width + j + 1] + 1
					: Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
	const pieces: Piece[] = []
	const push = (kind: Piece['kind'], text: string) => {
		const last = pieces[pieces.length - 1]
		if (last?.kind === kind) last.text += text
		else pieces.push({ kind, text })
	}
	let i = 0
	let j = 0
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			push('same', a[i])
			i++
			j++
		} else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
			push('removed', a[i++])
		} else {
			push('added', b[j++])
		}
	}
	while (i < a.length) push('removed', a[i++])
	while (j < b.length) push('added', b[j++])
	return pieces
}
