const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function load(file) {
	const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	})
	const module = { exports: {} }
	new Function('module', 'exports', outputText)(module, module.exports)
	return module.exports
}

const logic = load('plugins/JTP/js/logic.ts')
const ping = id => ({ id, author: 'a', text: '' })
// Both ids are above Number.MAX_SAFE_INTEGER and collapse to the same Number.
const A = '1300000000000000001'
const B = '1300000000000000002'

test('snowflakes are compared as BigInt, not as Number', () => {
	assert.equal(Number(A), Number(B))
	assert.equal(logic.compareIds(A, B), -1)
	assert.equal(logic.compareIds(B, A), 1)
	assert.equal(logic.compareIds('999999999999999999', '1000000000000000000'), -1)
	assert.equal(logic.previousId('1000000000000000000'), '999999999999999999')
	assert.equal(logic.nextId('999999999999999999'), '1000000000000000000')
})

test('snowflake validation rejects non-ids', () => {
	assert.equal(logic.isSnowflake(A), true)
	for (const bad of [undefined, null, 5, '', 'abc', '12', `${A}x`]) assert.equal(logic.isSnowflake(bad), false)
})

test('selectPings drops read pings, dedupes, sorts and keeps the newest count', () => {
	const list = [ping('300000000000000003'), ping('300000000000000001'), ping('300000000000000002'), ping('300000000000000002')]
	assert.deepEqual(logic.selectPings(list, '300000000000000002', 5).map(p => p.id), ['300000000000000002', '300000000000000003'])
	assert.deepEqual(logic.selectPings(list, null, 2).map(p => p.id), ['300000000000000002', '300000000000000003'])
	assert.deepEqual(logic.selectPings(list, null, 0), [])
	assert.deepEqual(logic.selectPings([ping(A), ping(B)], A, 5).map(p => p.id), [A, B])
})

test('isExact only trusts the first ping when the list is complete', () => {
	assert.equal(logic.isExact([ping(A)], 2, false), false)
	assert.equal(logic.isExact([ping(A)], 2, true), true)
	assert.equal(logic.isExact([ping(A), ping(B)], 2, false), true)
	assert.equal(logic.isExact([], 1, true), false)
})

test('isPing matches what Discord counts', () => {
	const ctx = { me: 'me', dm: false, roleIds: ['r1'], suppressEveryone: false, suppressRoles: false }
	const msg = extra => ({ id: A, author: { id: 'other' }, ...extra })
	assert.equal(logic.isPing(msg({ mentions: [{ id: 'me' }] }), ctx), true)
	assert.equal(logic.isPing(msg({ mentions: [{ id: 'x' }] }), ctx), false)
	assert.equal(logic.isPing(msg({ mention_roles: ['r1'] }), ctx), true)
	assert.equal(logic.isPing(msg({ mention_roles: ['r1'] }), { ...ctx, suppressRoles: true }), false)
	assert.equal(logic.isPing(msg({ mention_everyone: true }), ctx), true)
	assert.equal(logic.isPing(msg({ mention_everyone: true }), { ...ctx, suppressEveryone: true }), false)
	assert.equal(logic.isPing(msg({}), { ...ctx, dm: true }), true)
	// A reply that switched the mention off is not counted by Discord, so it must not be one here either.
	assert.equal(logic.isPing(msg({ referenced_message: { author: { id: 'me' } } }), ctx), false)
	assert.equal(logic.isPing({ id: A, author: { id: 'me' }, mentions: [{ id: 'me' }] }, ctx), false)
	assert.equal(logic.isPing({ id: 'nope', mentions: [{ id: 'me' }] }, ctx), false)
})
