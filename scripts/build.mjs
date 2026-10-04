import { cp, mkdir, rm } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const filename of ['index.html', 'favicon.svg', '.nojekyll', 'src']) await cp(new URL(filename, root), new URL(filename, output), { recursive: true });
console.log('Static site built in dist/');
