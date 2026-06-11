import { rm } from 'node:fs/promises';
import { glob } from 'node:fs/promises';

const targets = [];
for await (const entry of glob('{apps,packages}/*/{dist,coverage}')) {
  targets.push(entry);
}
for await (const entry of glob('**/*.tsbuildinfo', { exclude: ['**/node_modules/**'] })) {
  targets.push(entry);
}

await Promise.all(targets.map((t) => rm(t, { recursive: true, force: true })));
console.log(`Cleaned ${targets.length} artifact(s).`);
