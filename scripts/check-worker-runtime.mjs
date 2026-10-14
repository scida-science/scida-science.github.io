// Exercise the packaged Worker in workerd, not Node's different global APIs.
// GitHub is replaced with an in-memory fixture; no credentials or network access.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { discoveries } from '../src/data/discoveries.ts';

const scriptPath = fileURLToPath(new URL('../.worker-dist/index.js', import.meta.url));
await readFile(scriptPath); // Run npm run build:backend before this check.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const bindings = {
  FRONTEND_ORIGIN: 'https://scida.example',
  API_ORIGIN: 'https://api.scida.example',
  GITHUB_ORG: 'scida-runtime-fixture',
  ADMIN_REPOSITORY: 'scida-admin',
  ADMIN_GITHUB_ID: '100',
  GITHUB_APP_ID: '123',
  GITHUB_CLIENT_ID: 'runtime-client',
  GITHUB_INSTALLATION_ID: '456',
  GITHUB_PRIVATE_KEY: privateKey.export({ type: 'pkcs1', format: 'pem' }),
  GITHUB_CLIENT_SECRET: 'synthetic-client-secret',
  SESSION_SECRET: 'synthetic-session-secret-for-local-runtime-only',
  DISCUSSION_SECRET: 'synthetic-discussion-secret-for-local-runtime-only',
};
let admin = {
  schemaVersion: 1, profiles: {}, access: {}, applications: [], invitations: [],
  codeRequests: [], sessions: {}, exchanges: {}, audit: [],
};
const repos = discoveries.map((discovery) => ({
  name: 'discovery-' + discovery.id.toLowerCase(), private: true,
  archived: false, owner: { login: bindings.GITHUB_ORG },
}));
const repoPrefix = `/repos/${bindings.GITHUB_ORG}/`;
let requests = 0;
let installationTokens = 0;
let adminRevision = 1;
let redirectOAuth = false;
let redirectStorage = false;
const unexpected = [];
function file(value, sha = 'a'.repeat(40)) {
  const text = JSON.stringify(value);
  return Response.json({
    type: 'file', encoding: 'base64', sha,
    size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64'),
  });
}
function appAuthorization(request) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const parts = token.split('.');
  assert.equal(parts.length, 3, 'Worker must issue a signed App JWT');
  assert.ok(verify('RSA-SHA256', Buffer.from(parts.slice(0, 2).join('.')),
    publicKey, Buffer.from(parts[2], 'base64url')), 'workerd RSA signature verifies');
  assert.equal(JSON.parse(Buffer.from(parts[1], 'base64url').toString()).iss, bindings.GITHUB_APP_ID);
}
async function github(request) {
  requests++;
  const url = new URL(request.url);
  const path = url.pathname;
  if (url.origin === 'https://github.com' && path === '/login/oauth/access_token') {
    assert.equal(request.method, 'POST');
    if (redirectOAuth) return new Response(null, { status: 302, headers: { Location: 'https://redirect-must-not-be-followed.example/' } });
    assert.equal(request.headers.get('Content-Type'), 'application/x-www-form-urlencoded');
    assert.equal(request.headers.get('User-Agent'), 'SciDA-Research-Portal');
    const exchange = new URLSearchParams(await request.text());
    assert.equal(exchange.get('client_secret'), bindings.GITHUB_CLIENT_SECRET);
    assert.equal(exchange.get('redirect_uri'), bindings.API_ORIGIN + '/auth/callback');
    assert.match(exchange.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/);
    return Response.json({ access_token: 'synthetic-github-user-token' });
  }
  if (url.origin !== 'https://api.github.com') {
    unexpected.push('Unexpected outbound host');
    return new Response(null, { status: 500 });
  }
  if (path === `/app/installations/${bindings.GITHUB_INSTALLATION_ID}`) {
    appAuthorization(request);
    return Response.json({ account: { login: bindings.GITHUB_ORG }, suspended_at: null });
  }
  if (path === `/app/installations/${bindings.GITHUB_INSTALLATION_ID}/access_tokens`) {
    installationTokens++;
    appAuthorization(request);
    assert.equal(request.method, 'POST');
    return Response.json({ token: 'synthetic-installation-token', expires_at: new Date(Date.now() + 3_600_000).toISOString() });
  }
  if (path === '/user' || path === '/user/emails') {
    assert.equal(request.headers.get('Authorization'), 'Bearer synthetic-github-user-token');
    return Response.json(path === '/user'
      ? { id: 200, login: 'runtime-reader', name: 'Runtime Reader' }
      : [{ email: 'reader@example.test', primary: true, verified: true }]);
  }
  assert.equal(request.headers.get('Authorization'), 'Bearer synthetic-installation-token');
  if (path === '/installation/repositories') return redirectStorage
    ? new Response(null, { status: 302, headers: { Location: 'https://redirect-must-not-be-followed.example/' } })
    : Response.json({ repositories: repos });
  if (path === repoPrefix + 'scida-admin') return Response.json({ private: true, archived: false });
  if (path === repoPrefix + 'scida-admin/contents/scida/state.json') {
    if (request.method === 'PUT') {
      const update = await request.json();
      assert.equal(update.sha, String(adminRevision));
      admin = JSON.parse(Buffer.from(update.content, 'base64').toString());
      adminRevision++;
      return Response.json({ content: { sha: String(adminRevision) } });
    }
    return file(admin, String(adminRevision));
  }
  const match = repos.findIndex((repo) => path === repoPrefix + repo.name + '/contents/discovery.json');
  if (match >= 0) return file({
    schemaVersion: 1, visibility: 'public', discovery: discoveries[match],
    materials: { paper: null, appendix: null, figures: null, data: null, repository: null },
  });
  if (repos.some((repo) => path === repoPrefix + repo.name + '/issues')) return Response.json([]);
  unexpected.push('Unexpected fixture endpoint: ' + path);
  return new Response(null, { status: 404 });
}

const runtime = new Miniflare(convertV4MiniflareOptions({
  name: 'scida-runtime-check', modules: true, scriptPath,
  compatibilityDate: '2026-10-14', compatibilityFlags: ['nodejs_compat'],
  cf: false, bindings, outboundService: github,
}));
try {
  const health = await runtime.dispatchFetch(bindings.API_ORIGIN + '/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).configured, true);

  const portal = await runtime.dispatchFetch(bindings.API_ORIGIN + '/v1/portal', {
    headers: { Origin: bindings.FRONTEND_ORIGIN },
  });
  const body = await portal.json();
  assert.equal(portal.status, 200, 'Packaged portal must reach GitHub through the Workers native fetch API: ' + body.message);
  assert.equal(body.user, null);
  assert.equal(body.state.discoveries.length, 6);
  assert.equal(body.state.profiles.length, 0);
  assert.equal(portal.headers.get('Access-Control-Allow-Origin'), bindings.FRONTEND_ORIGIN);
  assert.deepEqual(unexpected, []);
  assert.ok(requests > 10, 'Portal must exercise real packaged GitHub transport');
  assert.equal(installationTokens, 1, 'Parallel cold-portal reads must share token initialization');

  const beforeAuth = requests;
  const verifier = 'V'.repeat(43);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const auth = await runtime.dispatchFetch(bindings.API_ORIGIN + '/auth/start?challenge=' + challenge + '&state=' + 'B'.repeat(43), { redirect: 'manual' });
  assert.equal(auth.status, 302);
  const authorize = new URL(auth.headers.get('Location'));
  assert.equal(authorize.origin, 'https://github.com');
  assert.equal(authorize.searchParams.get('redirect_uri'), bindings.API_ORIGIN + '/auth/callback');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.match(auth.headers.get('Set-Cookie'), /HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  assert.equal(requests, beforeAuth, 'Starting OAuth must not send outbound requests');
  const cookie = auth.headers.get('Set-Cookie').split(';', 1)[0];
  const callbackUrl = bindings.API_ORIGIN + '/auth/callback?code=synthetic-oauth-code&state=' + authorize.searchParams.get('state');
  const callback = await runtime.dispatchFetch(callbackUrl, { redirect: 'manual', headers: { Cookie: cookie } });
  assert.equal(callback.status, 302);
  const destination = new URL(callback.headers.get('Location'));
  assert.equal(destination.origin, bindings.FRONTEND_ORIGIN);
  const params = new URLSearchParams(destination.hash.split('?')[1]);
  assert.equal(params.get('error'), null, 'Callback must complete in workerd');
  assert.equal(params.get('state'), 'B'.repeat(43));
  assert.match(params.get('code'), /^[A-Za-z0-9_-]{43}$/);

  const post = (path, value, token) => runtime.dispatchFetch(bindings.API_ORIGIN + path, {
    method: 'POST', headers: {
      Origin: bindings.FRONTEND_ORIGIN, 'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    }, body: JSON.stringify(value),
  });
  const exchanged = await post('/auth/exchange', { code: params.get('code'), verifier });
  assert.equal(exchanged.status, 200);
  const { token } = await exchanged.json();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await post('/auth/exchange', { code: params.get('code'), verifier })).status, 401, 'OAuth exchange is single-use');
  const authenticated = await runtime.dispatchFetch(bindings.API_ORIGIN + '/v1/portal', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(authenticated.status, 200);
  const { user } = await authenticated.json();
  assert.equal(user.id, '200');
  assert.equal(user.role, 'Reader');
  assert.deepEqual(user.approvedTopics, []);
  assert.equal((await post('/v1/access/200', { role: 'Senior Approver', assignedTopics: ['bandit-theory'], approvedTopics: [] }, token)).status, 403);
  assert.equal(JSON.stringify(admin).includes('synthetic-github-user-token'), false, 'GitHub user tokens never persist');
  assert.equal(JSON.stringify(admin).includes(token), false, 'Only session hashes persist');
  assert.equal((await post('/auth/logout', {}, token)).status, 200);
  const revoked = await runtime.dispatchFetch(bindings.API_ORIGIN + '/v1/portal', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(revoked.status, 401);

  redirectOAuth = true;
  const failedCallback = await runtime.dispatchFetch(callbackUrl, { redirect: 'manual', headers: { Cookie: cookie } });
  const failedDestination = new URL(failedCallback.headers.get('Location'));
  assert.equal(failedDestination.origin, bindings.FRONTEND_ORIGIN);
  assert.ok(new URLSearchParams(failedDestination.hash.split('?')[1]).has('error'), 'OAuth redirects must fail closed');
  redirectStorage = true;
  const failedPortal = await runtime.dispatchFetch(bindings.API_ORIGIN + '/v1/portal');
  assert.equal(failedPortal.status, 503, 'Storage redirects must fail closed');
  assert.equal((await failedPortal.text()).includes('redirect-must-not-be-followed'), false);
  assert.deepEqual(unexpected, [], 'Neither transport follows redirects to another host');
  console.log('Packaged workerd runtime passed: App RSA JWT, GitHub transport, six discoveries, CORS, OAuth PKCE callback/exchange, Reader restrictions, session revocation, and redirect rejection. All GitHub responses were local fixtures.');
} finally {
  await runtime.dispose();
}
