import { createPrivateKey, sign } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AppScopeError, validateInstallation, validateRepositories } from './github-app-scope.mjs';

const org = 'scida-science';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const configPath = fileURLToPath(new URL('../backend/wrangler.jsonc', import.meta.url));
const expectedPermissions = { contents: 'write', issues: 'write', metadata: 'read', emails: 'read' };
class SetupError extends Error {}
const fail = (message) => { throw new SetupError(message); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const numericId = (value) => Number.isSafeInteger(value) && value > 0;

function appSlug(value) {
  let slug = value;
  if (value.includes('://')) {
    let url;
    try { url = new URL(value); } catch { fail('Use a public GitHub App URL or its slug.'); }
    const match = /^\/apps\/([a-z0-9-]+)\/?$/i.exec(url.pathname);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port ||
      url.username || url.password || url.search || url.hash || !match)
      fail('Use an exact https://github.com/apps/APP-SLUG URL.');
    slug = match[1];
  }
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/i.test(slug)) fail('The GitHub App slug is invalid.');
  return slug.toLowerCase();
}

function inside(directory, candidate) {
  const normalize = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  const rel = relative(normalize(directory), normalize(candidate));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}

async function privateKeyFromFile(path) {
  if (!isAbsolute(path)) fail('The downloaded PEM path must be absolute.');
  const root = await realpath(projectRoot);
  let actualPath;
  try { actualPath = await realpath(path); }
  catch { fail('The downloaded PEM file could not be found.'); }
  if (inside(resolve(projectRoot), resolve(path)) || inside(root, actualPath))
    fail('Keep the downloaded private key outside the public project directory.');
  const info = await stat(actualPath);
  if (!info.isFile() || info.size < 128 || info.size > 65536)
    fail('The PEM must be an ordinary private-key file smaller than 64 KB.');
  const pem = await readFile(actualPath, 'utf8');
  let key;
  try { key = createPrivateKey(pem); }
  catch { fail('The downloaded file is not a usable unencrypted private key.'); }
  if (key.asymmetricKeyType !== 'rsa') fail('A GitHub App RSA private key is required.');
  return { pem, key };
}

async function github(path, { token, method = 'GET', body, label = 'GitHub request' } = {}) {
  let response;
  try {
    response = await fetch('https://api.github.com' + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(25000),
      headers: {
        Accept: 'application/vnd.github+json', 'User-Agent': 'SciDA-App-Setup',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch { fail(`${label} failed to connect. Check the network and retry.`); }
  if (!response.ok) {
    await response.body?.cancel();
    fail(`${label} was rejected by GitHub (HTTP ${response.status}).`);
  }
  if (response.status === 204) return null;
  try { return await response.json(); }
  catch { fail(`${label} returned an invalid response.`); }
}

function assertOwner(app) {
  if (!object(app) || !numericId(app.id) || app.owner?.type !== 'Organization' ||
    app.owner?.login?.toLowerCase() !== org)
    fail('The App must be owned by the scida-science organization.');
}

function assertPermissions(permissions) {
  if (!object(permissions) || Object.keys(permissions).length !== Object.keys(expectedPermissions).length ||
    Object.entries(expectedPermissions).some(([name, level]) => permissions[name] !== level))
    fail('Set only Contents: write, Issues: write, Metadata: read, and Email addresses: read in the App.');
}

function jwt(appId, key) {
  const now = Math.floor(Date.now() / 1000);
  const message = [{ alg: 'RS256', typ: 'JWT' }, { iss: String(appId), iat: now - 60, exp: now + 540 }]
    .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
  return message + '.' + sign('RSA-SHA256', Buffer.from(message), key).toString('base64url');
}

async function verifyRepositories(installationId, appToken, selection) {
  const issued = await github(`/app/installations/${installationId}/access_tokens`, {
    token: appToken, method: 'POST', body: { permissions: { metadata: 'read' } },
    label: 'Temporary installation-token creation',
  });
  if (typeof issued?.token !== 'string' || issued.token.length < 20 || issued.token.length > 2048)
    fail('GitHub did not issue a usable temporary installation token.');
  const token = issued.token;
  try {
    const repositories = [];
    let complete = false;
    for (let page = 1; page <= 20; page++) {
      const data = await github(`/installation/repositories?per_page=100&page=${page}`, {
        token, label: 'Installed repository verification',
      });
      if (!object(data) || !Array.isArray(data.repositories) ||
        !Number.isSafeInteger(data.total_count) || data.total_count < 0 || data.total_count > 2000)
        fail('GitHub returned an unsupported installation repository list.');
      repositories.push(...data.repositories);
      if (repositories.length === data.total_count) { complete = true; break; }
      if (repositories.length > data.total_count || data.repositories.length === 0)
        fail('The installation repository list changed during verification. Retry setup.');
    }
    if (!complete) fail('The installation has too many repositories to verify.');
    return validateRepositories(repositories, selection);
  } finally {
    await github('/installation/token', {
      token, method: 'DELETE', label: 'Temporary installation-token revocation',
    });
  }
}

async function configure(slug, pemPath) {
  const { pem, key } = await privateKeyFromFile(pemPath);
  const publicApp = await github('/apps/' + encodeURIComponent(slug), { label: 'Public App lookup' });
  assertOwner(publicApp);
  const appToken = jwt(publicApp.id, key);
  const app = await github('/app', { token: appToken, label: 'App private-key verification' });
  assertOwner(app);
  if (app.id !== publicApp.id || app.slug !== slug) fail('The private key does not match the selected App.');
  if (typeof app.client_id !== 'string' || !/^[A-Za-z0-9._-]{8,128}$/.test(app.client_id))
    fail('GitHub did not return a usable App Client ID.');
  assertPermissions(app.permissions);
  const installation = await github(`/orgs/${org}/installation`, {
    token: appToken, label: 'Organization installation verification',
  });
  const selection = validateInstallation(installation, app.id);
  const names = await verifyRepositories(installation.id, appToken, selection);
  let config = await readFile(configPath, 'utf8');
  const identifiers = {
    GITHUB_APP_ID: String(app.id), GITHUB_CLIENT_ID: app.client_id,
    GITHUB_INSTALLATION_ID: String(installation.id),
  };
  for (const [name, value] of Object.entries(identifiers)) {
    const pattern = new RegExp(`("${name}"\\s*:\\s*)"[^"\\r\\n]*"`, 'g');
    if ([...config.matchAll(pattern)].length !== 1) fail(`Expected one ${name} string in backend/wrangler.jsonc.`);
    config = config.replace(pattern, (_, prefix) => prefix + JSON.stringify(value));
  }
  await writeFile(configPath, config, 'utf8');
  console.log('Verified App ownership, permissions, and private storage repositories.');
  console.log('Public identifiers: ' + JSON.stringify(identifiers));
  console.log('Installation repository scope: ' + selection);
  console.log('Private storage repositories: ' + names.join(', '));
  console.log('Uploading the private key directly to Wrangler; its value will not be displayed.');
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)),
    'secret', 'put', 'GITHUB_PRIVATE_KEY', '--config', configPath,
  ], {
    cwd: projectRoot, input: pem.endsWith('\n') ? pem : pem + '\n',
    stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
  });
  if (result.error || result.status !== 0)
    fail('Public identifiers were saved, but the private-key upload failed. Check Wrangler authentication and retry this command.');
  console.log('Private key uploaded through Wrangler secret put. Deploy the Worker after all four secrets are configured to apply the public identifiers.');
}

const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log('Usage: node scripts/configure-github-app.mjs <publicAppURLorSlug> <absolutePemFilePath>');
  console.log('Verifies scida-science ownership and private storage in an All or Selected installation, saves public App identifiers,');
  console.log('and uploads the downloaded PEM through Wrangler stdin. Keep the PEM outside this repository.');
} else if (args.length !== 2) {
  console.error('Usage: node scripts/configure-github-app.mjs <publicAppURLorSlug> <absolutePemFilePath>');
  process.exitCode = 1;
} else {
  try { await configure(appSlug(args[0]), args[1]); }
  catch (error) {
    console.error(error instanceof SetupError || error instanceof AppScopeError ? error.message : 'App setup failed because of an unexpected local or network error. No secret values were printed.');
    process.exitCode = 1;
  }
}
