import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Absolute output keeps Wrangler/esbuild on the same path on Windows and Linux.
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)),
  'deploy', '--dry-run',
  '--config', fileURLToPath(new URL('../backend/wrangler.jsonc', import.meta.url)),
  '--outdir', fileURLToPath(new URL('../.worker-dist', import.meta.url)),
], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
if(result.error) throw result.error;
process.exitCode = result.status ?? 1;
