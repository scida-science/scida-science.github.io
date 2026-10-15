// Move prepared ZIP parts to private draft-release assets without changing bytes.
// Check-only is the default; --upload requires a GitHub credential on stdin.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat, writeFile, rename } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const directory = await realpath(resolve(flag('--directory') ?? '.'));
const repository = flag('--repo');
const tag = flag('--tag');
const target = flag('--target');
const upload = args.includes('--upload');
if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    !tag || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(tag) ||
    !target || !/^[a-f0-9]{40}$/.test(target))
  throw new Error('Usage: node scripts/upload-reviewer-assets.mjs --directory <repo> --repo <owner/name> --tag <draft-tag> --target <40-char-commit> [--upload]');
const manifestPath = resolve(directory, 'reviewer/package.json');
const original = await readFile(manifestPath, 'utf8');
const manifest = JSON.parse(original);
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('Unsupported package manifest');
const parts = manifest.files.filter((file) => /^part\d{3,}$/.test(file.id));
if (!parts.length || parts.length > 1000) throw new Error('Package needs 1–1000 release assets');
async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
for (const file of manifest.files) {
  const actual = await realpath(resolve(directory, file.path));
  const rel = relative(directory, actual);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('Package path escapes repository');
  if (!(await stat(actual)).isFile() || (await stat(actual)).size !== file.size || await fileDigest(actual) !== file.sha256)
    throw new Error('Local package identity mismatch: ' + file.id);
  if (parts.includes(file) && (!/\.zip\.\d{3,}$/.test(basename(file.path)) || file.size > 100 * 1024 * 1024))
    throw new Error('Unsafe part name or size');
}
console.log(`Verified ${manifest.files.length} local files; ${parts.length} archive parts, ${manifest.size} ZIP bytes.`);
if (!upload) process.exit(0);
let credential = '';
for await (const bytes of process.stdin) credential += bytes;
credential = credential.trim();
if (!credential || /\s/.test(credential)) throw new Error('Provide the GitHub credential through stdin only');
const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${credential}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'SciDA-package-staging' };
async function api(path, init = {}) {
  const response = await fetch('https://api.github.com' + path, {
    ...init, redirect: 'manual', headers: { ...headers, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  if (!response.ok) throw new Error(`GitHub staging request failed (HTTP ${response.status}); no existing asset was overwritten.`);
  return response.json();
}
const base = '/repos/' + repository;
const repo = await api(base);
if (!repo.private || repo.archived || repo.full_name.toLowerCase() !== repository.toLowerCase())
  throw new Error('Asset storage must be the intended active PRIVATE repository');
const releases = [];
for (let page = 1; page <= 20; page++) {
  const rows = await api(`${base}/releases?per_page=100&page=${page}`);
  releases.push(...rows);
  if (rows.length < 100) break;
  if (page === 20) throw new Error('Release listing exceeds safety bound');
}
let release = releases.find((row) => row.tag_name === tag);
if (release && (!release.draft || release.target_commitish !== target))
  throw new Error('Existing release is not the intended private draft at this commit; inspect it before proceeding');
release ??= await api(`${base}/releases`, { method: 'POST', body: JSON.stringify({
  tag_name: tag, target_commitish: target, name: 'SciDA complete reviewer package (staged)',
  body: 'Private review package staging. The SciDA server enforces current topic permissions. No website deployment is triggered.',
  draft: true, prerelease: false, generate_release_notes: false,
}) });
const assets = [];
for (let page = 1; page <= 10; page++) {
  const rows = await api(`${base}/releases/${release.id}/assets?per_page=100&page=${page}`);
  assets.push(...rows);
  if (rows.length < 100) break;
}
for (const file of parts) {
  const name = basename(file.path);
  let asset = assets.find((row) => row.name === name);
  if (asset) {
    if (asset.state !== 'uploaded' || asset.size !== file.size || asset.digest !== `sha256:${file.sha256}`)
      throw new Error(`Existing asset differs or lacks a verifiable digest: ${name}; not overwritten.`);
    console.log(`Already staged and verified: ${name}`);
  } else {
    const response = await fetch(`https://uploads.github.com${base}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
      method: 'POST', redirect: 'manual', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size) },
      body: createReadStream(resolve(directory, file.path)), duplex: 'half', signal: AbortSignal.timeout(15 * 60 * 1000),
    });
    if (!response.ok) throw new Error(`Asset upload failed (HTTP ${response.status}): ${name}. Rerun to resume; inspect any incomplete asset before replacing it.`);
    asset = await response.json();
    if (asset.name !== name || asset.state !== 'uploaded' || asset.size !== file.size || asset.digest !== `sha256:${file.sha256}`)
      throw new Error(`Uploaded asset identity mismatch: ${name}`);
    console.log(`Staged and verified: ${name}`);
  }
  file.releaseAssetId = asset.id;
}
// Preserve the original manifest if any upload failed; record remote IDs only
// after every part matches. Atomic replacement also leaves scientific bytes intact.
if (await readFile(manifestPath, 'utf8') !== original) throw new Error('Package manifest changed during upload; refusing to overwrite it');
const temporary = manifestPath + '.asset-upload.tmp';
await writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
await rename(temporary, manifestPath);
console.log(`Complete private draft release: ${repository}, release ID ${release.id}; ${parts.length} parts. Updated reviewer/package.json. No branch was pushed or deployment performed.`);
