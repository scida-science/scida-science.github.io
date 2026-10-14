# SciDA — Scientific Discovery Agent

SciDA presents research produced through interactions with AI scientific research systems and supports review by topic. The React, TypeScript, and Vite frontend runs on GitHub Pages. A Cloudflare Worker handles GitHub sign-in, permissions, and access to private GitHub repositories. No external database, KV, or D1 service is used.

- Website: [scida-science.github.io](https://scida-science.github.io/)
- Public source: [scida-science/scida-science.github.io](https://github.com/scida-science/scida-science.github.io)
- Deployed API: [scida-api.scida-website.workers.dev](https://scida-api.scida-website.workers.dev/health)
- Local project: `C:\Users\sarve\OneDrive\Desktop\SciDA-website`
- Owner setup: [Deployment instructions](docs/DEPLOYMENT.md)

**Current setup:** the public website, seven private storage repositories, and deployed Worker shell exist. Organization base permissions have been set to None. Repository contents and an owner-authorized temporary file write/read/delete have been verified. The [SciDA Research Portal GitHub App](https://github.com/apps/scida-research-portal) is registered under `scida-science`, and its public permissions have been verified. Its installation and Worker credentials still need to be connected. Real GitHub login and shared writes through the deployed API remain unverified. Until it is connected, the website explicitly offers only six read-only illustrative discoveries. These are fictional examples, including their validation and publication labels. No accounts, comments, or approval decisions are fabricated.

The repository's `VITE_SCIDA_API_URL` variable is set to the deployed API. The deployment workflow requires a working GitHub data connection before publishing that frontend build, preserving the existing readable site while App setup is incomplete. `SESSION_SECRET` and `DISCUSSION_SECRET` are already stored in Cloudflare; their encrypted local backups remain outside this repository.

Use **Workers Free only, with $0 recurring costs**; do not enable paid plans or chargeable overages. Its 100,000 requests per day and 10 ms CPU allowance per invocation require testing the actual sign-in and storage routes after App setup. The owner confirmed **Workers Free** in the Cloudflare dashboard on 14 October 2026. Wrangler's subscription API returned `403`, so this plan confirmation comes from the owner, not an independent API check. [Pricing and limits](https://developers.cloudflare.com/workers/platform/pricing/).

## Run on Windows

Use Node.js 24 and npm. Resolve the Windows Desktop folder to accommodate OneDrive redirection:

```powershell
Set-Location (Join-Path ([Environment]::GetFolderPath('Desktop')) 'SciDA-website')
npm.cmd ci
if (-not (Test-Path -LiteralPath '.env.local')) { Copy-Item .env.example .env.local }
npm.cmd run dev
```

Open the printed address, normally `http://127.0.0.1:5173/`. Leave `VITE_SCIDA_API_URL` blank for the read-only examples. Once the Worker is ready, set that variable to its public HTTPS origin and restart Vite. No token or client secret belongs in a `VITE_` variable. The build allows only `VITE_SCIDA_API_URL`.

```powershell
npm.cmd test
npm.cmd run check:backend
npm.cmd run build:backend
npm.cmd run build
npm.cmd run preview
```

The frontend build is written to `dist/`; preview normally uses `http://127.0.0.1:4173/`. `build:backend` checks packaging without deploying. Stop a local server with `Ctrl+C`. Backend-only tests are available with `npm.cmd run test:backend`.

To start the Worker locally:

```powershell
npm.cmd run dev:backend
```

An unconfigured Worker reports account services unavailable. Full local GitHub sign-in requires a matching development callback, origins, GitHub App installation, and private local secrets; see [local backend development](docs/DEPLOYMENT.md#local-backend-development).

## Where the data lives

| Location                                                              | Purpose                                                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public `scida-science.github.io` repository                           | Frontend, Worker source, tests, schema, and six illustrative fallback briefs only                                                                |
| Private `scida-admin/scida/state.json`                                | Profiles, verified email identities, reviewer scopes, applications, invitations, code requests, access audit, and hashed sessions/exchange codes |
| Private `discovery-ai-001`, `discovery-ai-002`, `discovery-ai-003`    | Three illustrative Artificial Intelligence discovery records                                                                                     |
| Private `discovery-ast-001`, `discovery-ast-002`, `discovery-ast-003` | Three illustrative Astronomy discovery records                                                                                                   |
| Each discovery repository's `discovery.json`                          | Brief, manuscript version, publication stage, visibility, and explicit supporting-material access                                                |
| Issues and issue comments in each discovery repository                | Versioned expert discussion threads written and signed by the SciDA GitHub App                                                                   |

The Worker uses a GitHub App **installation token** for repository operations. A researcher's GitHub user token is used only to establish identity and a verified primary email, then discarded. Researchers do not need access to the underlying private repositories.

The organization must keep repository base permissions at **None**, and researchers should not be added as direct collaborators on administrative or discovery repositories. Direct GitHub access would let them read repository contents outside SciDA's topic and material permissions. Organization owners retain administrative repository access. See [GitHub's repository roles](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization).

Private repository storage does not automatically make a research brief private: `visibility: "public"` deliberately exposes its brief and discussion through the website. Only the six illustrative records are provisioned with public visibility. Use explicit `visibility: "signed-in"` for new research unless publication is intended. Material permissions are configured separately.

## Accounts and permissions

SciDA uses **Sign in with GitHub**. GitHub handles registration, passwords, recovery, and account security. The website has no password form or role selector. On first sign-in, the verified GitHub numeric ID receives Reader access, except for the configured owner identity.

The Worker enforces every permission using the current private records:

- Readers maintain their own profiles, request code, and apply for review topics.
- Reviewers post and reply only within approved topics. Approval for bandit theory grants no astronomy access.
- Approvers assess other researchers and create invitations only within assigned topics. They cannot appoint approvers or admins.
- The owner edits discovery content/status and appoints approvers. Admin status comes exclusively from `ADMIN_GITHUB_ID`, currently `89913681` for the verified owner `SarveshVGharat`. Profile edits and browser storage cannot change it.
- Discussion participation and reviewer-only materials still require explicit topic approval, including for the owner. Applications and invitations cannot be used for self-approval.

Invitations are single use, expire after seven days, bind to the recipient's verified GitHub primary email, and require confirmation of their exact topics. Only a code hash is stored; the creator sees the raw code once. Sharing that code and responding to code requests are manual tasks; no invitation or code-request email is sent automatically.

Profiles support selected research fields and matching expertise topics, an optional Google Scholar link, and application evidence. Scholar is not scraped. Email comes from the verified GitHub identity and is not editable in the profile. Other users' private email addresses are not exposed with discussion authors.

## Authentication and refresh behavior

The browser creates a PKCE verifier and random state, then navigates to the Worker and GitHub. The Worker uses an encrypted, HttpOnly cookie during this first-party OAuth flow. The callback returns a single-use exchange code to `/#/auth/callback`; the browser validates state, exchanges the code, and removes callback parameters. This avoids dependence on third-party cookies.

Only an opaque, revocable SciDA session is held in `sessionStorage`, for up to eight hours. The GitHub token is never returned to the browser. Session storage supports refreshes in the same tab; it does not hold profiles, comments, or privileges. Logout revokes the server session and clears the tab. Expiry or a `401` response removes the local identity and privileges. A failed server revocation is reported explicitly.

Visible pages refresh shared data every two minutes and when the tab regains focus. The Refresh control is also available. The backend reads current account permissions, sessions, discovery visibility, and material policies for each request; only short-lived GitHub installation tokens are cached. Configured API failures remain visible and never activate simulated accounts or fake successful submissions.

## Edit discoveries and materials

For a connected site, edit the appropriate private repository's `discovery.json`, or use the owner-only research editor. The stable `discovery.id` determines the page URL, for example `/#/discoveries/AI-001`. Advance `version` when changing the manuscript and `updatedAt` when editing directly on GitHub. New discussions attach to the current version; replies remain attached to their original thread's version.

The owner manages file paths, external URLs, and material access in the **top-level** `materials` map in `discovery.json`; these fields are read-only in the website editor. Keep `discovery.materials` compatibility fields null in repository documents. Missing top-level entries remain null and show “Not uploaded yet.” Restricted material is distinguished from missing material. The Worker generates authorized download endpoints and streams private files as attachments; the frontend does not receive a private GitHub download URL or repository token.

Use [the discovery schema](docs/discovery.schema.json) and [the material examples](docs/DEPLOYMENT.md#discovery-format-and-supporting-materials). Keep real manuscripts, unpublished data, and private links out of this public website repository.

To change the six **unconfigured frontend examples**, edit the typed file [src/data/discoveries.ts](src/data/discoveries.ts). It is also the source for initial illustrative repository seeds. Updating this source does not overwrite existing private research records. The [provisioning script](scripts/provision-repositories.ps1) creates missing repositories/files and preserves existing files.

To add research, create a private, non-archived `discovery-*` repository in `scida-science`, add a valid root `discovery.json` on its default branch, and enable Issues. The owner has chosen **All repositories** for the App installation, so future repositories are included automatically. The connected website discovers valid records on refresh; a GitHub Pages rebuild or another installation-selection step is unnecessary. The App's GitHub permission grant covers all organization repositories, while SciDA imports only matching private discoveries and uses `scida-admin` separately. [Detailed steps](docs/DEPLOYMENT.md#adding-a-discovery).

## GitHub Pages deployment

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) tests the application, checks/packages the Worker, builds the frontend, and deploys GitHub Pages on pushes to `main`. It does not deploy the Worker or receive Worker secrets.

The repository is the organization homepage, so Vite's base path is `/`. `HashRouter` keeps discovery refreshes working without server rewrites. If moving to a project repository, change the Vite base to `/<repository-name>/`, keep hash routes, and update the configured frontend destination and authentication callback handling accordingly.

Set the repository **Actions variable** `VITE_SCIDA_API_URL` to `https://scida-api.scida-website.workers.dev` after connecting and checking the Worker, then rerun **Build and deploy SciDA**. Changing backend research records does not require rebuilding the frontend; changing this build-time API setting does.

## Verification and remaining work

Automated tests cover frontend navigation/filtering/profile behavior, PKCE state and session handling, authorized API calls, server topic/access restrictions, invitation confirmation, versioned discussion, GitHub write conflicts, and material authorization. The production frontend and Worker can be checked with the commands above. These tests use controlled adapters and HTTP fixtures; they do not establish that an unconfigured external deployment is working.

Before inviting real reviewers, complete [deployment and the live verification checklist](docs/DEPLOYMENT.md#verify-the-live-system): GitHub App registration/installation, Worker credentials, owner sign-in, a separate Reader's denied admin actions, shared persistence from a second browser, and authorized materials. Use the exact callback `https://scida-api.scida-website.workers.dev/auth/callback`, with wildcard matching and authorization during installation disabled. Enter the GitHub client secret only in the local Wrangler prompt and upload the downloaded PEM directly from a file outside the repository. Real OAuth, deployed session revocation, writes through the installed App, and the workload's compatibility with Workers Free remain unverified until that setup is completed.

This version suits a small research community. GitHub API and Worker limits, whole-file private state updates, and the absence of a transaction across repositories limit concurrency. Private Git history retains earlier personal data and session hashes; deleting a current record is not deletion from history or backups. See [operations and limits](docs/DEPLOYMENT.md#operations-and-limits) before collecting real applications at scale.
