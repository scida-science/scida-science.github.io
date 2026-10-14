# Deploy the SciDA GitHub backend

The frontend stays at **https://scida-science.github.io/**. A Cloudflare Worker is the recommended serverless API because this project already includes its configuration and can keep GitHub credentials off the website. All application data remains in private GitHub files and Issues; no external database, KV, D1, or other storage binding is required. Review the current [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [limits](https://developers.cloudflare.com/workers/platform/limits/) for your account rather than assuming the free plan will fit every workload.

The Free plan can be tried for initial validation, but its 10 ms CPU allowance per invocation can constrain this Worker's cryptography and JSON processing. As checked on 14 October 2026, Workers Paid starts at $5 per month; validate the workload and current charges before choosing a production plan. [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/), [CPU limits](https://developers.cloudflare.com/workers/platform/limits/).

The website source and seven private repositories have been provisioned. The backend has not yet been deployed or connected to a GitHub App, and live OAuth/shared writes have not been tested. Complete the following steps using the organization owner's GitHub account and your Cloudflare account.

## 1. Confirm private storage and organization access

In `scida-science`, keep these repositories private and active:

| Repository          | Required initial content                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `scida-admin`       | `scida/state.json`, schema version 1, initially empty account/access/application/session collections |
| `discovery-ai-001`  | `discovery.json` for `AI-001`                                                                        |
| `discovery-ai-002`  | `discovery.json` for `AI-002`                                                                        |
| `discovery-ai-003`  | `discovery.json` for `AI-003`                                                                        |
| `discovery-ast-001` | `discovery.json` for `AST-001`                                                                       |
| `discovery-ast-002` | `discovery.json` for `AST-002`                                                                       |
| `discovery-ast-003` | `discovery.json` for `AST-003`                                                                       |

Enable Issues on each discovery repository. The six existing records are explicitly illustrative and have `visibility: "public"`; their material maps contain only nulls. No accounts, approval decisions, comments, or requests are seeded.

**Keep organization repository base permissions at None.** This setting has been applied and verified; the organization currently has one owner member. To inspect it, open organization Settings → Member privileges → Base permissions. Also review direct/team grants to these seven repositories. Researchers should use SciDA without repository collaborator or organization-member access; repository access would bypass the website's content restrictions. Owners still have repository administration rights. [GitHub's base-permission instructions](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/setting-base-permissions-for-an-organization).

If a required repository/file is missing, the following optional command uses the authenticated Git Credential Manager account. It verifies organization-owner access, creates only missing private repositories/files, and preserves existing work:

```powershell
Set-Location (Join-Path ([Environment]::GetFolderPath('Desktop')) 'SciDA-website')
& .\scripts\provision-repositories.ps1
```

This script is provisioning, not synchronization: it does not overwrite existing briefs or reset existing administrative data.

## 2. Create the Worker endpoint

Install dependencies, sign in to Cloudflare, and deploy the included Worker shell:

```powershell
npm.cmd ci
npx.cmd wrangler login
npm.cmd run check:backend
npm.cmd run build:backend
npm.cmd run deploy:backend
```

Wrangler prompts for your Cloudflare account when needed. Record the actual `https://scida-api.<your-subdomain>.workers.dev` address it prints. This first deployment can run with placeholders; `/health` reports `configured: false`, and account/data endpoints return an explicit `503`. No fake authentication is enabled.

In [backend/wrangler.jsonc](../backend/wrangler.jsonc), set `API_ORIGIN` to that exact origin, with **no trailing slash**. Keep `FRONTEND_ORIGIN` exactly `https://scida-science.github.io`, also without a trailing slash. The worker name is `scida-api`; no custom domain is required. [Wrangler deployment commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/).

## 3. Register the organization's GitHub App

Open [scida-science's GitHub App settings](https://github.com/organizations/scida-science/settings/apps) and register a **GitHub App** owned by `scida-science`.

Configure:

- Homepage URL: `https://scida-science.github.io/`.
- Callback URL: your exact `API_ORIGIN` followed by `/auth/callback`.
- Webhooks: disable **Active**; this implementation does not use webhooks.
- Device flow: disabled.
- Expiring user authorization tokens: enabled. SciDA discards the user token after reading identity and verified email.
- App visibility: **public / Any account**, so researchers outside the organization can authorize it. Public App visibility does not make any research repository public. [GitHub App visibility](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private).

Set only these permissions:

| Permission category | Permission      | Level          |
| ------------------- | --------------- | -------------- |
| Repository          | Contents        | Read and write |
| Repository          | Issues          | Read and write |
| Repository          | Metadata        | Read-only      |
| Account             | Email addresses | Read-only      |
| Organization        | All             | No access      |

Account email permission is needed to verify the researcher's primary email through GitHub's `/user/emails` endpoint. Repository permissions are exercised by the organization's installation token, not by the researcher's token. [GitHub App registration](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app), [permission selection](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app), and [email API requirements](https://docs.github.com/en/rest/users/emails#list-email-addresses-for-the-authenticated-user).

Record the App ID and Client ID, generate a client secret, and generate/download a private key. Keep the secret and PEM file outside this public repository. The Worker accepts GitHub's downloaded PKCS#1 PEM and PKCS#8 PEM, including multiline values.

Install the App in **scida-science** with **Only select repositories**, selecting exactly `scida-admin` and the six private discovery repositories listed above. Do not select the public `scida-science.github.io` source repository. Record the numeric installation ID from the installation's settings URL. Researchers authorize sign-in; they do not need to install the App themselves or join the organization.

## 4. Set identifiers and Worker secrets

Fill in the public identifiers in `backend/wrangler.jsonc`:

| Variable                 | Value                                                        |
| ------------------------ | ------------------------------------------------------------ |
| `FRONTEND_ORIGIN`        | `https://scida-science.github.io`                            |
| `API_ORIGIN`             | Actual deployed Worker origin, without a trailing slash      |
| `GITHUB_ORG`             | `scida-science`                                              |
| `ADMIN_REPOSITORY`       | `scida-admin`                                                |
| `ADMIN_GITHUB_ID`        | `89913681` — verified GitHub numeric ID for `SarveshVGharat` |
| `GITHUB_APP_ID`          | App ID from GitHub App settings                              |
| `GITHUB_CLIENT_ID`       | Client ID from the same App                                  |
| `GITHUB_INSTALLATION_ID` | Organization installation ID                                 |

The owner ID is the entire admin bootstrap mechanism: after GitHub verifies that identity, the server recognizes it as Admin. Every other new account starts as Reader. A username, email, profile field, session-storage value, or public API request cannot assign Admin. Replacing the owner requires a deliberate Worker configuration change by the deployment owner.

Store the following four values as **Worker secrets**, never in `vars`, `.env.local`, a `VITE_` variable, a GitHub Issue, or Git history. Use interactive prompts for single-line values:

```powershell
npx.cmd wrangler secret put GITHUB_CLIENT_SECRET --config backend/wrangler.jsonc
npx.cmd wrangler secret put SESSION_SECRET --config backend/wrangler.jsonc
npx.cmd wrangler secret put DISCUSSION_SECRET --config backend/wrangler.jsonc
```

For `GITHUB_PRIVATE_KEY`, pipe the downloaded file directly. Replace the example file path with its actual secure location:

```powershell
Get-Content -LiteralPath 'C:\secure\scida-app.private-key.pem' -Raw | npx.cmd wrangler secret put GITHUB_PRIVATE_KEY --config backend/wrangler.jsonc
```

Generate **two independent, cryptographically random values of at least 32 characters** for `SESSION_SECRET` and `DISCUSSION_SECRET`, and retain encrypted backups in your password manager. The first protects the OAuth attempt cookie. The second signs discussion records so forged or edited GitHub entries cannot impersonate reviewers. Keep `DISCUSSION_SECRET` stable: changing it without a deliberate re-signing migration makes historical discussion signatures unverifiable. Rotating `SESSION_SECRET` invalidates pending OAuth cookies; revoking existing SciDA sessions requires removing their hashed records or using logout.

Wrangler's `secret put` deploys a new Worker version; after setting all values, deploy once more to apply the completed configuration. [Cloudflare secret storage and deployment behavior](https://developers.cloudflare.com/workers/configuration/secrets/).

```powershell
npm.cmd run deploy:backend
Invoke-RestMethod 'https://scida-api.YOUR-SUBDOMAIN.workers.dev/health'
```

Use your actual address in the health command. It should return `configured: true`. This checks configuration presence, not GitHub connectivity or working OAuth. Keep the subsequent live checks mandatory.

## 5. Connect GitHub Pages

In the public [website repository](https://github.com/scida-science/scida-science.github.io), open Settings → Secrets and variables → Actions → **Variables**. Add:

```text
VITE_SCIDA_API_URL=https://scida-api.YOUR-SUBDOMAIN.workers.dev
```

This URL is public. Add no credential variables: Vite bundles public configuration into the downloaded JavaScript, and this project's build rejects additional `VITE_` names.

Ensure Settings → Pages → Source is **GitHub Actions**. Run the **Build and deploy SciDA** workflow from `main` or push the reviewed changes. It runs tests, checks and dry-runs Worker packaging, then builds/deploys the frontend. The workflow does not deploy the Worker and contains no Cloudflare or GitHub App secrets.

The organization homepage uses Vite base `/` and `HashRouter`. Refreshing `https://scida-science.github.io/#/discoveries/AI-001` keeps the same page. The OAuth return uses `/#/auth/callback?code=…&state=…`; the verifier/state must be present in the same browser tab that started sign-in. There are no SciDA passwords or recovery links: GitHub manages those account functions.

## Verify the live system

Use real, authorized owner and Reader GitHub accounts. Test accounts below describe required roles; no credentials or accounts are supplied by this project.

1. Open the website signed out. Confirm only public briefs/discussions appear, filters work, and a discovery survives a refresh.
2. Select **Sign in with GitHub**, authorize the App, and return in the same tab. Confirm the owner account receives Admin and a different account receives Reader. Confirm no GitHub credential or OAuth code remains in the page URL.
3. Edit the Reader's profile, refresh, and sign in from a second browser. Confirm the same saved profile appears. Its email must come from GitHub and remain read-only.
4. As Reader, attempt direct API writes to discovery content/status and account access using that Reader's SciDA session. Confirm server denials, not just hidden buttons. Never place a session token in a URL or committed test file.
5. Apply for bandit-theory review access. Use the owner to appoint a separate approver with that scope. Confirm the approver can decide the application but cannot appoint another approver or approve astronomy topics.
6. Post a valid bandit discussion and reply. Confirm the signed root Issue and reply comment exist in the appropriate private discovery repository and appear after another browser refreshes. Confirm the same reviewer cannot post in astronomy.
7. Create an invitation for a different account's verified primary GitHub email. Preview must grant nothing; exact scope confirmation grants only its topics. Wrong-email, reused, expired, and revoked-inviter cases must fail.
8. Submit a code request. Confirm it is visible to the requesting user and owner, and persists in private administrative storage.
9. Configure a small non-sensitive test attachment with a reviewer restriction. Confirm approved access works and a Reader's direct API request is denied. Confirm private file downloads contain no GitHub token or private download URL.
10. Sign out and verify the old SciDA bearer session is rejected. Check automatic expiry, a rejected expired session, and normal reauthentication. If GitHub or the Worker fails, confirm an honest error rather than a successful-looking write.

Passing local tests or `/health` alone does not complete these checks. Record the deployed Worker URL and outcomes before opening reviewer registration broadly.

## Adding a discovery

1. As organization owner, create a **private** repository named `discovery-<stable-name>` under `scida-science`; keep Issues enabled and the repository unarchived.
2. Put a valid `discovery.json` on its default branch. Copy the structure of an existing illustrative record, replace its content carefully, and choose a unique stable `discovery.id`. Use explicit `visibility: "signed-in"` for new work. Public visibility is a deliberate publication decision.
3. Add this repository to the existing GitHub App installation's **selected repositories**. It does not require granting the researcher repository access.
4. Refresh SciDA. The Worker discovers installed private `discovery-*` repositories automatically; no website rebuild or repository-name list needs updating.

Use [discovery.schema.json](discovery.schema.json) for the format. IDs must be unique across all discovery repositories. An invalid configuration produces an error, so validate the document before committing. Keep scientific prose consistent with the reference papers in the corresponding research project's `writing_style/` directory when editing actual research; the existing illustrative prose is unchanged by backend setup.

## Discovery format and supporting materials

Every repository document has `schemaVersion: 1`, an explicit `visibility`, a `discovery` object, and a top-level `materials` map. `visibility` controls access to the brief and its discussion. The five top-level material entries independently select a file or HTTPS URL and its access:

```json
{
  "paper": { "path": "manuscript/paper.pdf", "access": "reader" },
  "appendix": { "path": "manuscript/appendix.pdf", "access": "reviewer" },
  "figures": null,
  "data": { "path": "data/review-sample.csv", "access": "reviewer" },
  "repository": {
    "url": "https://github.com/scida-science/discovery-example",
    "access": "admin"
  }
}
```

This is a format example, not a set of uploaded files or working research links. Create the referenced files before adding their mappings. A relative `path` is confined to that discovery repository and cannot contain traversal, encoded path segments, backslashes, or URL delimiters. An external `url` must use HTTPS; the Worker returns it after permission checks and never attaches its credentials to that external destination. An external link's own host still controls access after navigation.

| `access`   | Required permission                                                       |
| ---------- | ------------------------------------------------------------------------- |
| `public`   | The discovery itself must be visible to this visitor                      |
| `reader`   | A signed-in account that can see the discovery                            |
| `reviewer` | Approved review access for the discovery's topic, including for the owner |
| `admin`    | The configured owner GitHub ID                                            |

Public materials can be opened without signing in when the brief is public. Restricted materials show an access notice, and the API checks permission again on every download. Do not mark sensitive content as `public`.

Keep all fields inside the nested `discovery.materials` object null in repository documents; those compatibility slots are replaced with authorized API endpoints in responses. The top-level map is authoritative. Material paths/access and discovery visibility are managed directly in the private GitHub document, not through the website's research editor. Updating research text/status through the owner UI preserves these settings.

When editing GitHub files directly, advance `discovery.updatedAt` to an ISO timestamp and update `discovery.version` for manuscript revisions. API responses also carry a `revision` containing the GitHub file's blob SHA; the owner editor must return it unchanged, and a missing or stale revision is rejected. This field is response-only: do not add it to `discovery.json`. Existing threads keep their manuscript version; replies can continue those threads after a revision, while new threads use the current version.

## Local backend development

For UI-only work, keep `.env.local` with a blank API URL; the six bundled examples remain available. For full local integration, use development GitHub App credentials and a controlled installation/repository set. Local Worker calls still write real GitHub records; there is no simulated backend.

Put local secret values in ignored `backend/.dev.vars`, beside the Wrangler configuration. Use the same four secret names as production; quote multiline private-key content or use escaped newlines. Do not put them in the frontend `.env.local`. [Cloudflare local secret instructions](https://developers.cloudflare.com/workers/configuration/secrets/#local-development-with-secrets).

Configure the development App's callback as `http://127.0.0.1:8787/auth/callback`, use its App/client/installation identifiers, and override the Worker origins locally:

```powershell
npm.cmd run dev:backend -- --var FRONTEND_ORIGIN:http://127.0.0.1:5173 --var API_ORIGIN:http://127.0.0.1:8787
```

In the frontend's ignored `.env.local`, set `VITE_SCIDA_API_URL=http://127.0.0.1:8787`, then run `npm.cmd run dev` in another PowerShell window. Keep ports and origins exact; the Worker rejects submissions from an unexpected origin. Do not commit development credentials or accidentally deploy local origin overrides.

## Operations and limits

Administrative changes use GitHub Contents API SHA checks and bounded retries; discovery editor conflicts require a refresh. A discussion root is a GitHub Issue, and replies are Issue comments. Only entries authored by the SciDA App with a valid HMAC metadata envelope are rendered as scientific discussion. Direct GitHub comments and edited/forged envelopes are not imported as reviewer posts. Backup both private Issues and repository contents if archiving research discussions.

There is **no distributed transaction** spanning the administrative repository and a discovery repository. A permission revocation and an already-authorized cross-repository write can race. Revocations govern subsequent authorization checks; this architecture cannot guarantee instantaneous cancellation of an in-flight write. Use this version for modest traffic and avoid describing it as a high-concurrency transactional service.

Visible tabs refresh every 120 seconds, on focus, and by manual request. The Worker reads current permissions, sessions, discovery visibility, and material policy on every request. It caches only short-lived installation tokens. This favors current authorization but costs GitHub API calls; review [GitHub API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) and [Worker limits](https://developers.cloudflare.com/workers/platform/limits/) as usage grows. No rate-limit bypass or hidden database is provided.

The private administrative JSON file has an approximately 2 MB read limit and a bounded encoded write size. Profiles, audit records, applications, requests, and session history therefore need an owner-managed archival plan before reaching the cap. Repository enumeration and Issue pagination are bounded as well; unusually large installations/discussions return an error rather than silently pretending that all records were loaded.

Git commits retain previous values, including private email addresses and application evidence. Current session/exchange tokens are stored only as hashes, but their historical hashes also remain in Git history. Deleting an account from the latest JSON does not erase it from Git history, clones, or backups. Keep backups private, restrict administrative repository access, and establish an appropriate retention/deletion process before collecting substantial personal material.

Preserve `DISCUSSION_SECRET` with encrypted backups. If it is compromised or intentionally rotated, plan a verified migration of signed discussion records; simply replacing it causes previous signatures to fail. Deleting hashed session records revokes the corresponding SciDA sessions. Rotating the OAuth-cookie secret alone does not revoke those sessions.

GitHub Pages deploys only the public frontend. Worker changes require `npm.cmd run deploy:backend`; secret changes go through Wrangler or Cloudflare's secret controls. Changes to private research records become visible through refresh without publishing private content into the website source. Never commit private manuscripts, research data, credentials, local environment files, or downloaded key files to the public repository.
