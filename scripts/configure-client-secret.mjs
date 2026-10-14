// Read only from a local masked prompt's stdin. Never accept secrets in arguments.
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const configPath = fileURLToPath(new URL('../backend/wrangler.jsonc', import.meta.url));
const wranglerPath = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
class SetupError extends Error {}
const fail = (message) => { throw new SetupError(message); };

async function main() {
  if (process.argv.length !== 2 || process.stdin.isTTY)
    fail('Use the local configure-client-secret.ps1 masked prompt. Do not put a secret in command arguments.');
  let secret = '';
  for await (const chunk of process.stdin) {
    secret += chunk;
    if (secret.length > 4096) fail('The supplied value is too long for a client secret.');
  }
  secret = secret.trim();
  const config = await readFile(configPath, 'utf8');
  const clientId = config.match(/"GITHUB_CLIENT_ID"\s*:\s*"([^"]+)"/)?.[1];
  // Public identifier verified against the organization's App registration.
  if (clientId !== 'Iv23liWvIlvAJaPfQb6f') fail('The Worker Client ID differs from the verified SciDA App. Recheck the registration before changing secrets.');
  if (secret === clientId)
    fail('This is the App public Client ID, not its client secret. Paste the newly generated client secret VALUE. Nothing was uploaded.');
  if (/^https?:\/\//i.test(secret))
    fail('This is a URL, not a client secret. Paste the newly generated client secret VALUE. Nothing was uploaded.');
  if (secret.includes('PRIVATE KEY'))
    fail('This is a private key, not a client secret. Use Credentials > Client secrets, not Key pairs. Nothing was uploaded.');
  if (/^(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|\/(?:Users|home|tmp|mnt)\/)/i.test(secret) || /\.pem$/i.test(secret))
    fail('This is a file path, not a client secret. Paste the newly generated client secret VALUE. Nothing was uploaded.');
  if (secret.length < 20 || /\s/.test(secret))
    fail('Paste only the complete generated client secret VALUE, without its label, App ID, masked display, or surrounding instructions. Nothing was uploaded.');
  const headers = {
    Accept: 'application/vnd.github+json', 'User-Agent': 'SciDA-Client-Secret-Setup',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  // GitHub documents 404 for an invalid token AFTER Basic App authentication.
  // This random nonexistent token cannot create, modify, or revoke an account.
  const check = await fetch(`https://api.github.com/applications/${encodeURIComponent(clientId)}/token`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000),
    headers: {
      ...headers, 'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64'),
    },
    body: JSON.stringify({ access_token: 'ghu_' + randomBytes(20).toString('hex') }),
  });
  await check.body?.cancel();
  if (check.status === 401) fail('GitHub rejected this client secret. Generate and copy the secret VALUE for SciDA Research Portal, then retry. Nothing was uploaded.');
  if (check.status !== 404) fail(`GitHub returned HTTP ${check.status}; credential verification is inconclusive. Nothing was uploaded.`);
  console.log('GitHub accepted the App credentials. Uploading the validated value through Wrangler.');
  const result = spawnSync(process.execPath, [wranglerPath, 'secret', 'put', 'GITHUB_CLIENT_SECRET', '--config', configPath], {
    input: secret, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true,
  });
  secret = '';
  if (result.error || result.status !== 0) fail('Wrangler upload failed. The secret was not saved to a local file.');
  console.log('SUCCESS: verified client secret uploaded. Tell Codex done.');
}

main().catch((error) => {
  // Only our static messages are shown. Never dump a request or provider body.
  const message = error instanceof SetupError ? error.message : 'Local setup or network verification failed. Retry the local setup.';
  console.error(message);
  process.exitCode = 1;
});
