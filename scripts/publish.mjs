import { readFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
await mkdir('pool', { recursive: true });
for (const root of ['plugins', 'themes']) {
  for (const folder of await readdir(root)) {
    const manifest = JSON.parse(await readFile(`${root}/${folder}/manifest.json`, 'utf8'));
    const filename = `${manifest.id}@${manifest.version}.zip`;
    await copyFile(`build/dist/${filename}`, `pool/${filename}`);
  }
}
const cli = resolve('node_modules/@valenced/plugin-cli/bin/valenced-plugin.js');
const result = spawnSync(process.execPath, [cli, 'generate-index', '--dist', 'pool', '--base-url', 'https://raw.githubusercontent.com/dariussbezy/dariussbezy-Valenced-Plugins-Themes/refs/heads/main/pool', '--out', 'index.json'], { stdio: 'inherit' });
if (result.status !== 0) throw new Error('Official index generation failed');
console.log('Prepared all plugin archives and the single repository index on main.');
