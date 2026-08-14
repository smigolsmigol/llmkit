import { access, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packagesRoot = resolve(scriptDir, '..', 'packages');
const packageRoot = resolve(process.cwd());
const packageName = relative(packagesRoot, packageRoot);

if (
  !packageName
  || isAbsolute(packageName)
  || packageName === '..'
  || packageName.startsWith(`..${sep}`)
  || packageName.includes(sep)
) {
  throw new Error(`Refusing to clean outside one direct package directory: ${packageRoot}`);
}

await access(join(packageRoot, 'package.json'));
const dist = join(packageRoot, 'dist');
await rm(dist, { recursive: true, force: true, maxRetries: 3 });
console.log(`CLEAN_PACKAGE_DIST PASS (${packageName})`);
