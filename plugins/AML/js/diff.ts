export type Piece = { kind: 'same' | 'removed' | 'added'; text: string }

const tokens = (text: string) => text.match(/\s+|[^\s]+/g) ?? []

/** Longest common subsequence of two token lists, as same/removed/added pieces. */
function lcs(a: string[], b: string[], before: string, after: string): Piece[] {
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

/**
 * The difference between two versions of a text: by words, then by letters inside a changed word,
 * so "bomba:" to "bomba" marks only the ":".
 */
export function diffWords(before: string, after: string): Piece[] {
	const words = lcs(tokens(before), tokens(after), before, after)
	const pieces: Piece[] = []
	for (let k = 0; k < words.length; k++) {
		const piece = words[k]
		const next = words[k + 1]
		if (piece.kind === 'removed' && next?.kind === 'added') {
			const letters = lcs(
				[...piece.text],
				[...next.text],
				piece.text,
				next.text,
			)
			const kept = letters
				.filter(part => part.kind === 'same')
				.reduce((sum, part) => sum + part.text.length, 0)
			// Only when the versions are mostly alike; otherwise letter marks would be noise.
			if (kept * 2 >= Math.max(piece.text.length, next.text.length)) {
				pieces.push(...letters)
				k++
				continue
			}
		}
		pieces.push(piece)
	}
	return pieces
}
