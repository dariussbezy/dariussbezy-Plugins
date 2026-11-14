const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('JTP settings show the version from their manifest', () => {
	for (const code of ['JTP']) {
		const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', code, 'js', 'settings.tsx'), 'utf8')
		assert.match(source, /import manifest from '\.\.\/manifest\.json'/, code)
		assert.match(source, /\{manifest\.version\}/, code)
	}
})
