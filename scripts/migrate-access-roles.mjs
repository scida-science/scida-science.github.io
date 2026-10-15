// Owner-only maintenance. Dry-run by default; --apply writes with GitHub SHA checks.
// Credentials stay in Git Credential Manager. Never writes private records to disk.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { build } from 'esbuild';

const flags = process.argv.slice(2);
if (flags.some((flag) => flag !== '--apply') || flags.length > 1)
  throw new Error('Usage: node scripts/migrate-access-roles.mjs [--apply]');
const apply = flags.includes('--apply');
const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse((await readFile(new URL('../backend/wrangler.jsonc', import.meta.url), 'utf8')).replace(/,\s*([}\]])/g, '$1'));
const { GITHUB_ORG: org, ADMIN_REPOSITORY: repo, ADMIN_GITHUB_ID: ownerId } = config.vars;
if (!/^[\w-]+$/.test(org) || !/^[\w.-]+$/.test(repo) || !/^[1-9]\d+$/.test(ownerId))
  throw new Error('Review the configured organization, private storage repository and owner ID.');
const bundled = await build({ stdin: { contents: 'export { migrateAccessRoles } from "./backend/accessRoles";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false });
const { migrateAccessRoles } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
function unchanged(actual, expected, message) {
  // Assertion diffs would expose private records on failure; emit only the reason.
  if (!isDeepStrictEqual(actual, expected)) throw new Error(message);
}
let credential;
try {
  credential = execFileSync('git', ['-c', 'credential.interactive=never', 'credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
    env: { ...process.env, GCM_INTERACTIVE: 'Never' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
} catch { throw new Error('Authenticate the configured owner in Git Credential Manager, then retry.'); }
const secret = credential.split(/\r?\n/).find((line) => line.startsWith('password='))?.slice(9);
credential = undefined;
if (!secret) throw new Error('Git Credential Manager did not return a credential.');
const headers = { Authorization: `Bearer ${secret}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
async function api(route, body) {
  const response = await fetch('https://api.github.com' + route, {
    method: body ? 'PUT' : 'GET', headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const error = new Error(`GitHub migration request failed (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
const owner = await api('/user');
if (String(owner.id) !== ownerId) throw new Error('Only the configured SciDA owner may run this migration.');
const repoPath = `/repos/${org}/${repo}`;
const recordPath = repoPath + '/contents/scida/state.json';
for (let attempt = 0; attempt < 4; attempt++) {
  const metadata = await api(repoPath);
  if (!metadata.private || metadata.archived || metadata.full_name.toLowerCase() !== `${org}/${repo}`.toLowerCase())
    throw new Error('Administrative storage must remain an active private repository.');
  const file = await api(recordPath);
  if (file.type !== 'file' || file.encoding !== 'base64' || file.size > 2000000)
    throw new Error('Unsupported administrative file format or size.');
  const state = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  if (state.schemaVersion !== 1 || !state.access || typeof state.access !== 'object' || Array.isArray(state.access))
    throw new Error('Unsupported administrative state.');
  const before = structuredClone(state);
  const counts = migrateAccessRoles(state);
  const { access: oldAccess, ...unrelatedBefore } = before;
  const { access: newAccess, ...unrelatedAfter } = state;
  unchanged(unrelatedAfter, unrelatedBefore, 'Migration must preserve all non-access records.');
  unchanged(Object.keys(newAccess), Object.keys(oldAccess), 'Migration must not add or remove accounts.');
  for (const [id, original] of Object.entries(oldAccess)) {
    const expected = structuredClone(original);
    if (expected?.role === 'Senior Approver') expected.role = 'Senior Reviewer';
    else if (expected?.role === 'Approver') { expected.role = 'Reviewer'; expected.assignedTopics = []; }
    unchanged(newAccess[id], expected, 'Migration changed unrelated account permissions.');
  }
  if (!counts.renamedSeniorApprovers && !counts.convertedApprovers) {
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...counts, changed: false }));
    break;
  }
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', ...counts, changed: false, readyToApply: true }));
    break;
  }
  const content = Buffer.from(JSON.stringify(state, null, 2) + '\n').toString('base64');
  if (content.length > 2600000) throw new Error('Administrative storage is too large for a safe write.');
  try {
    const result = await api(recordPath, { sha: file.sha, content, message: 'Rename senior approval role and retire redundant Approver role' });
    const verified = await api(recordPath + '?ref=' + encodeURIComponent(result.commit.sha));
    unchanged(JSON.parse(Buffer.from(verified.content, 'base64').toString('utf8')), state, 'Migration commit did not match the intended state.');
    console.log(JSON.stringify({ mode: 'apply', ...counts, changed: true, verified: true, commit: result.commit.sha }));
    break;
  } catch (error) {
    if (error.status !== 409 || attempt === 3) throw error;
  }
}
