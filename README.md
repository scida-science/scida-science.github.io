# SciDA — Scientific Discovery Agent

SciDA presents investigations developed with AI scientific research systems and supports review by research topic. The React, TypeScript and Vite frontend runs on GitHub Pages. A Cloudflare Worker handles GitHub sign-in, authorization and private GitHub storage. This implementation uses no external database, KV or D1 service.

This release integrates three real astronomy investigations and **Persistent Betting**, all **Awaiting Validation**, with evidence figures, public papers and protected reviewer packages. Historical examples are isolated in test fixtures. The production frontend has no example fallback, and the backend excludes illustrative records. GitHub Pages deploys from `main`; private investigation default branches supply the research content, and the matching Worker is deployed separately.

Persistent Betting uses a repository-backed 13-section brief, mathematical headline and section equations, and a complete public paper. Its compact reviewer ZIP contains paper, analysis and Lean folders and uses the same topic-specific approval checks as the astronomy packages. Research content and reviewer materials remain in the private `information-optimal-bandits` repository; none is bundled into this public website source. See the current release record in [deployment documentation](docs/DEPLOYMENT.md).

Earlier deployment documentation records successful owner/Reader sign-in on 14 October 2026. Those are historical checks, not a fresh verification of reviewer posting or large-package downloads. See [verification and remaining work](#verification-and-remaining-work).

Sign-in opens **Explore**. **Following** lists the discoveries saved with the Follow button on a research card or investigation page, ordered by their latest update. Profile, reviewer access and sign-out are available from the account-name menu. Follows are private account preferences persisted in the administrative GitHub repository, separate from editable profile fields; following does not grant review or material access. Existing accounts need no migration.

Discussion posts and threaded replies support Markdown: emphasis, headings, lists, links, quotes, fenced code, tables, task lists and LaTeX math (`$x^2$` inline, or `$$` on separate lines for a display equation). **Preview** uses the same renderer as saved comments and does not submit the draft. Markdown source remains in the existing signed GitHub discussion records, with the same topic permissions, manuscript version and 6,000-character limit. Existing comments need no migration. Raw HTML is not executed; unsafe links are blocked, and images appear as links rather than loading remote content. The Markdown renderer loads only when a comment or preview needs it.

**Archive** preserves investigations marked **Not supported**, **Refuted**, or **Withdrawn**. Explore lists active investigations; Archive lists archived investigations with field, outcome and text filters. Following retains archived discoveries already followed. Their stable discovery links, papers, evidence, materials and versioned discussions remain available under the existing access rules. Archiving does not delete content or archive the underlying GitHub repository.

To archive or restore an investigation, sign in as the owner Admin, open its discovery page, choose **Edit discovery**, select the new status and enter a public reason (10–2,000 characters). Every status transition requires an explanation. Restoring uses an active status, such as **Awaiting Validation**, and appends another decision without erasing the earlier outcome. The Worker enforces Admin access and records the reason, previous/new status, server timestamp, Admin identity and manuscript version in `discovery.statusHistory`. It preserves existing history and ignores caller-supplied decisions; stale revisions cannot overwrite newer decisions. Existing active records need no migration. The Archive remains empty until an Admin actually archives a discovery; software tests do not establish any scientific outcome.

## Repository map

| Location | Purpose |
| --- | --- |
| [src/](src/) | Frontend, routing, account state and API client |
| [src/pages/HomePage.tsx](src/pages/HomePage.tsx) | Scrolling discovery feed and detail-page links |
| [src/pages/DiscoveryPage.tsx](src/pages/DiscoveryPage.tsx) | Research sections, figures, downloads, code requests and discussion |
| [src/components/EvidenceFigure.tsx](src/components/EvidenceFigure.tsx) | Authenticated PNG loading, captions and alt text |
| [src/data/topics.ts](src/data/topics.ts) | Research-field and topic taxonomy |
| [test/fixtures/discoveries.ts](test/fixtures/discoveries.ts) | Historical synthetic test records, excluded from production builds and provisioning |
| [backend/](backend/) | Worker routes, GitHub storage, permissions and OAuth |
| [docs/discovery.schema.json](docs/discovery.schema.json) | Discovery-document schema, version 1 |
| [docs/REPOSITORY_CONTENT.md](docs/REPOSITORY_CONTENT.md) | Evidence fields, provenance conventions and release boundary |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment procedure and dated operational observations |
| [scripts/](scripts/) | Build, runtime checks, content validation and owner setup helpers |
| [.github/workflows/deploy.yml](.github/workflows/deploy.yml) | Tests, frontend build and Pages deployment |
| `dist/`, `.worker-dist/` | Ignored generated frontend and packaged Worker output |

Private manuscripts, scientific inputs, internal records and correspondence do not belong in this public website repository. Private investigation repositories hold their own briefs, selected materials and complete reviewer packages under `reviewer/`. Their concise root READMEs guide reproduction; website integration and access operations belong here.

## Local setup and preview

Use **Node.js 24** and npm, matching CI. The documentation audit used Node 24.15.0 and npm 11.12.1 on Windows. The lockfile fixes dependencies. Installation needs package-registry access; fixture tests need no GitHub or Cloudflare credentials once dependencies are installed.

From this repository's root in PowerShell:

```powershell
npm.cmd ci
if (-not (Test-Path -LiteralPath '.env.local')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
}
npm.cmd run dev
```

Use `npm` instead of `npm.cmd` on other platforms. Open Vite's printed address, normally `http://127.0.0.1:5173/`. Stop it with `Ctrl+C`. The copy command preserves existing configuration; choose the intended mode in your own `.env.local`:

- **Unconfigured preview:** leave `VITE_SCIDA_API_URL` blank. An honest unavailable/empty state appears; no discoveries, accounts or successful submissions are invented.
- **Connected frontend:** set that variable to the intended Worker origin and restart Vite. This reads that Worker's actual repositories. Placing private checkouts beside this project does not automatically load them into Vite.
- **Build preview:** use the commands below. Preview serves `dist/`, normally at `http://127.0.0.1:4173/`; it does not start a Worker. API configuration is fixed at build time, so rebuild after changing it.

```powershell
npm.cmd run build
npm.cmd run preview
```

Only `VITE_SCIDA_API_URL` is allowed as frontend configuration. It must be an HTTPS origin, or HTTP on localhost/127.0.0.1 for development, without credentials, path, query or fragment. Every `VITE_` value is browser-visible; never place secrets there. See [.env.example](.env.example) and [vite.config.ts](vite.config.ts).

## Checks and expected outputs

| Command from this repository | Scope or output |
| --- | --- |
| `npm.cmd test` | Frontend, service and backend tests, including access, conflicts and evidence metadata/transport |
| `npm.cmd run test:backend` | Backend test subset |
| `npm.cmd run check:backend` | Worker TypeScript checking without emitted files |
| `npm.cmd run build:backend` | Wrangler dry-run packaging into `.worker-dist/`; no deployment |
| `npm.cmd run test:worker` | Packaged Worker in workerd with local GitHub fixtures for signing, OAuth, access and transport |
| `npm.cmd run build` | TypeScript checks and production frontend assets in `dist/` |
| `node scripts/validate-discovery.mjs <content-repository>` | Schema, semantic links, asset/material paths, hashes and private claim-pointer consistency for a prepared package |
| `python scripts/test-prepare-reviewer-package.py` | Small synthetic packing, integrity and extraction tests; no research analysis |
| `$env:SCIDA_DISCOVERY_ROOT='../SciDA-discoveries'; npm.cmd test` | Adds three opt-in UI integration checks using private local discovery files; no research is copied into the public source |

For the current sibling-checkout arrangement:

```powershell
node scripts/validate-discovery.mjs ../SciDA-discoveries/GRB180411A_Dust_Echo ../SciDA-discoveries/TOI475_Ephemeris_Discrepancy ../SciDA-discoveries/TIC233166139_APOGEE_Mass_Ratio
```

Replace the directory arguments if your checkouts are elsewhere. Success prints one line per investigation with figure and traced-claim counts. These local checks need no credentials; access to the private checkouts and ignored archive parts must already have been granted separately. Add `--require-release-assets` before the directories to require uploaded asset IDs for every part. A fresh Git clone contains the small manifests, papers and figures; the large parts must be obtained separately through authorized package access before checking their local hashes.

The content validator requires non-illustrative records, checks equations for valid KaTeX syntax, and verifies internal provenance manifests when present. It accepts the supported active and archive statuses, with valid decision history for archived records. Do not change a scientific status just to satisfy a test. Passing software checks does not establish scientific validity or novelty.

To include the actual bandit content and material-access integration checks, set `$env:SCIDA_BANDIT_REPOSITORY` to your private `information-optimal-bandits` checkout before running `npm.cmd test`. This reads local files without copying them into the public website repository; GitHub transport and test identities remain isolated fixtures. Normal CI skips these private-content checks when the checkout is unavailable.

## How repositories supply the site

The Worker imports active, private repositories with the GitHub repository topic `scida-discovery` (legacy `discovery-*` names are also recognized) in the configured organization that the GitHub App can access. It reads each root `discovery.json` from the repository's **default branch**, in batches of three. It uses `scida-admin` separately for accounts and workflow records. A malformed configuration or duplicate discovery ID can fail the feed; validate before releasing a record.

| Prepared repository | Stable ID | Investigation |
| --- | --- | --- |
| `GRB180411A_Dust_Echo` | `AST-001` | GRB 180411A dust-echo candidate |
| `TOI475_Ephemeris_Discrepancy` | `AST-002` | TOI-475 ephemeris discrepancy |
| `TIC233166139_APOGEE_Mass_Ratio` | `AST-003` | TIC 233166139 stellar-binary mass ratio |

Repository names identify storage; `discovery.id` identifies the website page, such as `/#/discoveries/AST-002`. Only records with `illustrative: false` enter the feed. Legacy placeholder repositories remain preserved but excluded. Stable IDs retain page, request and discussion references; they are not displayed as scientific titles.

Each document has four top-level fields:

| Field | Contract |
| --- | --- |
| `schemaVersion` | `1` |
| `visibility` | `public` or `signed-in`; controls the brief, selected inline figures and discussion |
| `discovery` | ID, title, field/topic, status, summary, timestamp/version, review note, sections and optional question/evidence fields |
| `materials` | Authoritative `paper`, `appendix`, `figures`, `data` and `repository` entries: null, or a relative path/HTTPS URL with an access policy; path materials can specify `format: "multipart-zip"` for a complete reviewer package |

The scrolling card uses `title`, `question`, `summary`, `status`, `reviewNote`, `updatedAt` and the figure named by `headlineFigureId`, then links to the detail page. The detail page renders `sections` in order and places each figure beside its matching `sectionId`. Paragraph breaks are retained; optional equations load KaTeX only when needed.

Each figure has `id`, repository-relative PNG `path`, `caption`, `alt` and `sectionId`. Figure IDs must be unique, the headline must identify one of them and section targets must exist. The schema permits up to 12 figures. The image endpoint checks authorization, PNG signature and a 16 MiB limit. Captions should distinguish statistical intervals, systematic ranges and illustrative models.

The frontend reads `/v1/portal` and requests images through `/v1/discoveries/{id}/evidence/{figureId}`. It uses the existing SciDA session and revocable browser object URLs. Images stay in the investigation repository; no GitHub credential or private GitHub download URL reaches the browser.

PDFs and downloads use `/v1/discoveries/{id}/materials/{kind}`. A repository `path` is streamed as an authorized attachment. For an HTTPS `url`, the Worker returns the link after authorization; it does not fetch it or send GitHub credentials to the external host. That host controls access after navigation.

For `format: "multipart-zip"`, the path instead identifies the package index. The authorized endpoint returns a file list; `/v1/discoveries/{id}/materials/{kind}/files/{fileId}` rechecks the **same existing material permission** for every file. The Worker serves only declared files from that package directory and never returns private GitHub URLs. The browser verifies each file's length and SHA-256 before saving it, with bounded memory per part. Package metadata never grants an account a role or topic.

Keep all nested `discovery.materials` compatibility slots **null** in repository documents. The top-level map is authoritative; the API generates accessible endpoints. Paths cannot contain traversal, encoded segments, backslashes or URL delimiters. Reuse one PDF path when appendices are in the paper; use null if there is no appendix. Missing and restricted materials have different UI messages.

## Accounts, access and code requests

Public visibility exposes the brief, selected images and rendered discussion through SciDA even though GitHub storage is private. Signed-in briefs require an account. Inline figures inherit brief visibility; there is no per-figure access policy.

| Material access | Requirement |
| --- | --- |
| `public` | Permission to see the discovery |
| `reader` | A signed-in account that can see it |
| `reviewer` | Review access for its topic, including current Senior Approver scope or the owner |
| `admin` | Configured owner identity |

The astronomy records configure public briefs, selected images and paper PDFs, with sign-in required for selected supporting downloads. Their **Analysis package** material uses the existing `reviewer` access level for the investigation's topic and points to the complete reviewer package. Direct GitHub access is not required. Accounts that already have material access see **Open analysis package**; other signed-in accounts see **Request code access**, which records a request without granting access.

GitHub handles identity, passwords and recovery. A researcher's GitHub token establishes identity and verified primary email, then is discarded; repository operations use an App installation token. The browser holds only a revocable SciDA session (token and expiry) in `localStorage`, so closing a tab or browser preserves sign-in until the server-enforced eight-hour expiry. An existing tab session migrates once when this version first loads. Profile data and permissions still come from the server. Pending OAuth state and the PKCE verifier remain in tab-only `sessionStorage`; OAuth also uses a first-party HttpOnly cookie and a single-use exchange code. Logout revokes the session and clears the browser identity across tabs; expiry or HTTP 401 also clears it. Browser storage must be enabled, and private browsing may discard it when its windows close. Configured API failures remain visible and never fabricate accounts or successful actions.

- **Readers** manage their own profiles, request code and apply for review topics.
- **Reviewers** discuss discoveries in approved topics.
- **Approvers** have approved-topic review access but cannot approve others or create invitations merely by holding that role.
- **Senior Approvers** assess other researchers and create invitations within assigned topics; those assignments also grant review/material access in the same topics.
- **Admin** is selected solely by `ADMIN_GITHUB_ID`, manages roles and research content/status, and has all-topic review access. Profile edits and browser storage cannot assign this role.

Invitations are single-use, expire after seven days and bind to a verified email and exact topics. Revocations govern subsequent permission checks. Profile interests personalize **For you** without granting review access; **Recent discoveries** remains chronological. Scholar links are optional and not scraped. Other users' private email addresses are not published with discussion authors.

Signed-in readers submit code requests with an explanation. Requests are recorded for the requester and administrator. The administrator handles the request through the existing topic-approval/access workflow. An account already approved for that topic can download its complete analysis package; a request alone grants no access. There is no per-request download grant, automatic email, repository invitation or license grant. Review permission is not direct GitHub repository access.

Keep organization repository base permissions at None and avoid direct collaborator/team access for portal researchers: it bypasses SciDA's restrictions. Owners retain underlying repository access. Keep internal records and correspondence outside public fields and served material/figure maps; describe their purpose without copying their contents into public documentation.

## Complete reviewer packages

The three investigation checkouts contain `reviewer/package.json`, `README.md`, `assemble.py`, `archive.json` and numbered ZIP parts under `reviewer/parts/`. The parts are ignored by Git and staged as assets of a private draft release; they must not enter Git history. `package.json` records the archive identity and each served file's ID, relative path, byte count and SHA-256, plus `releaseAssetId` for uploaded parts. `archive.json` supplies the ordered parts for offline assembly. The original research tree stays intact inside the archive, alongside a concise reviewer guide; original source manifests and scientific bytes are preserved.

The **Analysis package** panel lets an approved reviewer save the complete package to a chosen folder in browsers supporting directory access, or download individual files. Save all files together with their original names, then run `python assemble.py` with Python 3.12. The helper verifies all parts and the complete archive, rejects unsafe ZIP paths, and extracts into a fresh directory without an additional joined-ZIP copy. `python assemble.py --verify-only` checks the download without extraction. Existing destination directories are not overwritten. Directory downloads stop on an error; a retry verifies existing files and refuses to overwrite different content.

To prepare a replacement from a complete, manifest-backed research bundle, run this from the website checkout. Supply your own paths; the tool requires an unused `reviewer/` destination and does not edit the scientific source:

```powershell
python scripts/prepare-reviewer-package.py --source "../research/GRB180411A_Dust_Echo" --repository "../SciDA-discoveries/GRB180411A_Dust_Echo" --name GRB180411A_Dust_Echo-reviewer
node scripts/validate-discovery.mjs ../SciDA-discoveries/GRB180411A_Dust_Echo
```

The Python 3.12 tool needs no extra packages. It verifies the source release inventory, creates deterministic ZIP64 parts of at most 48 MiB, then compares every archived file with the original. It includes all release-manifest inputs, scripts, configurations, locks, manuscript files and retained results. Only unindexed runtime caches are excluded. It adds `reviewer/.gitignore` to keep parts out of Git. Preserve `reviewer/** -text` so Git cannot change checksummed helper bytes. No Git LFS or paid storage is used.

Map the result as `materials.repository: { "path": "reviewer/package.json", "access": "reviewer", "format": "multipart-zip" }`. Keep other material policies unchanged. Packages belong only in the private investigation repositories. Release matching frontend/backend support before the metadata; this preparation does not push or publish any files. Large repository uploads and production downloads still require a later deployment check. Scientific reproduction requirements and limitations, including TOI-475's unverified complete combined replay, are in each reviewer README.

Run `node scripts/upload-reviewer-assets.mjs --directory <local-investigation> --repo scida-science/<repository> --tag reviewer-package-20261015 --target <existing-40-character-commit>` to verify every local package file. With `--upload`, supply a GitHub credential through stdin only; the helper creates or resumes a private draft release, verifies remote asset names, sizes and SHA-256 digests, uploads missing parts and then records their IDs in `reviewer/package.json`. It refuses differing collisions and never overwrites an existing asset. Commit only the small manifests/helpers and scientific presentation files, then push a non-deploying branch. Draft assets do not publish the site. Keep preserved pre-migration branches local if their history contains archive blobs.

[GitHub releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas) permit up to 1,000 assets per release, each under 2 GiB, with no total release-size or bandwidth quota. The unchanged 48 MiB parts fit those limits. The existing GitHub App can read private assets with Contents permission. The Worker checks the current topic permission for every file, validates the remote asset identity, and follows only an allowed GitHub asset-CDN redirect without forwarding credentials. The browser receives an attachment stream, never a signed GitHub URL. [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/) include 128 MB memory, 10 ms CPU, 50 external subrequests per request and 100,000 requests/day; response bodies have no enforced size limit. Streaming keeps archive bytes out of Worker memory and hashing stays in the browser. Actual authenticated production downloads remain a publication check.

## Add or update an investigation

1. Use a dedicated branch in the appropriate private content repository. A new investigation needs a private, active repository with a descriptive scientific name, the `scida-discovery` repository topic, Issues enabled, and a unique stable ID. Repository creation and release are separate owner actions.
2. Read the current manuscript and results. Update the question, summary, context, methods, uncertainty, limitations, contributions and availability together. Computational checks do not establish human approval, physical confirmation or novelty.
3. Add selected PNGs with traceable captions/alt text. Keep headline and section IDs consistent. Reference an existing paper path where practical; update its material mapping if it moves. Distinguish the compact website selection from the full executable research bundle.
4. Maintain private claim/provenance inventories against actual source and asset bytes. They support validation and maintenance, not public rendering. Check that public fields/downloads contain no internal notes or correspondence.
5. Advance `updatedAt` for metadata changes and `version` for manuscript changes. Do not add the API-only `revision` SHA to repository JSON. The editor rejects stale revisions; existing discussion threads retain their original manuscript version.
6. Validate content and paths. The owner editor handles research text/status while preserving repository-managed visibility, material policies and figure paths. Manage these and figure captions directly in the private repository.
7. Commit for review. A content branch is not a live preview source. Following a separately authorized release, default-branch content appears on refresh without a frontend rebuild. Matching schema/backend/rendering changes must be released first.

The recorded App installation uses All repositories; selected-repository installations instead need each new repository explicitly added. App permissions are broader than SciDA's private-discovery import filter. The [provisioning helper](scripts/provision-repositories.ps1) initializes only missing empty administrative storage and preserves existing records; it neither creates example discoveries nor synchronizes scientific content. Test fixtures never supply production data.

## Configuration and local Worker development

[backend/env.ts](backend/env.ts) defines required configuration. [backend/wrangler.jsonc](backend/wrangler.jsonc) holds non-secret deployment settings and the configured production origins.

| Setting | Purpose |
| --- | --- |
| `FRONTEND_ORIGIN`, `API_ORIGIN` | Exact origins without trailing slash |
| `GITHUB_ORG`, `ADMIN_REPOSITORY` | Organization and private account-state repository |
| `ADMIN_GITHUB_ID` | Numeric owner identity; Admin bootstrap mechanism |
| `GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, `GITHUB_INSTALLATION_ID` | App and installation identifiers |
| `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY` | Worker secrets for OAuth and installation authentication |
| `SESSION_SECRET`, `DISCUSSION_SECRET` | Separate Worker secrets of at least 32 characters for OAuth-cookie protection and signed discussions |
| `VITE_SCIDA_API_URL` | Sole browser-visible build setting; a repository Actions variable for Pages |

Use secret stores or ignored development files for values. Preserve the discussion secret: rotation without migration makes historical signatures unverifiable. Rotating the OAuth-cookie secret does not revoke existing server sessions. Fixture tests require none of these secret values.

Authenticated local development needs a development App, controlled repositories, matching identifiers and callback `http://127.0.0.1:8787/auth/callback`. Put the four secrets in ignored `backend/.dev.vars`, beside Wrangler's configuration. Configure development identifiers deliberately; local Worker integration can write real GitHub records and is not a simulated backend.

```powershell
npm.cmd run dev:backend -- --var FRONTEND_ORIGIN:http://127.0.0.1:5173 --var API_ORIGIN:http://127.0.0.1:8787
```

Set the frontend's ignored `.env.local` to `VITE_SCIDA_API_URL=http://127.0.0.1:8787` and start Vite in another terminal. Keep exact origins/ports aligned. An unconfigured Worker reports unavailable services. Authenticated local OAuth was not exercised in this documentation pass.

## Deployment

Deploy through the existing main-branch Pages workflow and the separate Worker command below. The current Persistent Betting release and its checks are recorded in [deployment documentation](docs/DEPLOYMENT.md#persistent-betting-release-15-october-2026). Keep the hosting policy at **Workers Free with $0 recurring cost**; do not enable paid plans or chargeable overages as part of setup.

The earlier astronomy preparation used `content/astronomy-investigations-20261015` in this repository and `content/astronomy-release-20261015` in the three private investigations. Those releases preserved scientific commits and remote ancestry while excluding archive-blob commits. Preserve the original local preparation branches; do not push their large archive blobs. The deployed site now reads real research from private default branches. Repository renames preserve their GitHub identities, permissions and history.

1. Confirm private storage, organization access and App installation. Required App permissions are repository Contents/Issues read-write, Metadata read-only and account email read-only. Use the exact API `/auth/callback`; disable wildcard callbacks and authorization during installation. See [deployment instructions](docs/DEPLOYMENT.md).
2. Set identifiers and four Worker secrets using the approved local Wrangler/Cloudflare procedure. Secret operations can deploy a Worker version; they are not read-only verification. Keep keys, values and encrypted backups outside public Git history.
3. Run the checks above. When authorized, deploy the Worker separately with `npm.cmd run deploy:backend`. `build:backend` is a dry run. `/health` reporting `configured: true` checks configuration presence, not connectivity or working OAuth.
4. Use `node scripts/verify-live.mjs --require-configured` for read-only-effect smoke checks. It defaults to the production API and accepts `SCIDA_API_URL` as an HTTPS override. Its frontend origin is fixed in the script, so it is not a general local/staging checker. Negative authorization probes must not mutate records. Verify real authenticated/material workflows separately.
5. Set Pages source to GitHub Actions and configure its `VITE_SCIDA_API_URL` repository variable. The [workflow](.github/workflows/deploy.yml) tests/packages the Worker and builds the frontend; it deploys Pages only from `main`. Pushes to `content/**` run checks only: Pages configuration, artifact upload and deployment require `main`. Its live API smoke check runs only for a configured `main` build; a blank variable yields an honest unavailable state. The workflow does not deploy the Worker or receive Worker secrets.
6. Release matching Worker/frontend support before merging metadata that uses the new figure fields. Merging a public discovery document to its default branch can expose it on the next read. Content changes need no Pages rebuild; frontend or build-time API configuration changes do.

The organization homepage uses Vite base `/` and `HashRouter`. Detail-page refreshes need no server rewrites. Moving to a project-hosted site requires updating the Vite base and frontend/authentication destinations together.

## Verification and remaining work

Current bandit-release checks and limitations are recorded in [deployment documentation](docs/DEPLOYMENT.md#persistent-betting-release-15-october-2026). The following astronomy-package observations are retained as historical verification, rather than claims of a fresh scientific replay or live authenticated test.

The integration on **15 October 2026** passed a production build, backend type checks, **316 automated tests including the three opt-in private-content UI checks**, a fresh Worker dry-run build and the packaged workerd fixture check. Package-specific tests cover authorization before any file read, wrong-topic/Reader denial, revocation between files, unsafe manifests, protected release-asset redirects, download checksums and UI handling. These establish specified software behavior, not astronomical validity.

All three complete archives passed every part/aggregate SHA-256, ZIP member CRC, safe-path and source-inventory checks. The full paper and exact reviewer guide are present in each. Nine synthetic packaging tests passed; one filesystem-symlink creation test was skipped because Windows denied that capability. ZIP symlink and traversal tests passed. No scientific analyses, fresh environment installations or deployments were performed.

An actual GitHub App download of all nine stellar-binary release assets transferred **428,025,018 bytes in 42.495 seconds**, with matching part/archive hashes and complete extraction of 6,955 scientific-package files plus the reviewer guide. The three small helpers, public PDF and three PNGs were also fetched through the backend from the pushed preparation branch and matched local hashes. Anonymous, Reader and wrong-topic package requests were denied before any GitHub call. This exercised real GitHub transport with isolated local authentication fixtures under Node; it did **not** test a real reviewer's browser session or the deployed Workers Free runtime. No production account records were changed.

All **174 archive parts** are staged in private draft releases: 55 for GRB, 110 for TOI-475 and nine for the stellar binary. GitHub asset sizes and SHA-256 digests match the local manifests. GRB and TOI-475 also passed real App downloads of their three helpers, public papers, all six figures, and first/last archive parts; full remote downloads of these two larger archives were not repeated. A local backend check using real GitHub data with preparation-branch references returned exactly three non-illustrative investigations, all Awaiting Validation. Its anonymous response exposed the three papers and nine figures, while withholding protected package URLs and private administrative records. Without branch overrides, the new backend excluded all six old placeholder records. These are preparation-branch checks, not a deployment: all four default branches remain unchanged, and the website branch's GitHub Actions build passed with deployment skipped.

The owner authorized the coordinated frontend/Worker release and content-branch merges on 15 October 2026. Follow deployment with desktop/mobile inspection, actual signed-in package downloads on Workers Free, reviewer approval/discussion checks, and real-world performance checks. Fresh-machine dependency installation and TOI-475's complete combined scientific replay remain unverified; the latter was deliberately not run. The deployment guide retains older owner/Reader sign-in and persistence results without treating them as verification of this release.

Other operational limitations:

- Browser layout verification and the native folder picker remain unverified because browser startup failed. Figures were inspected separately and package controls have component tests; these do not replace a live browser check.
- Visible tabs refresh every 120 seconds, on focus and manually. Authorization is reread per request; only installation tokens are cached. GitHub/network latency and API/Worker limits constrain throughput. Earlier CPU measurements showed pressure against the then-documented Free allowance; capacity under real authenticated traffic is unresolved.
- Administrative state uses whole-file SHA-checked writes with bounded retries and an approximately 2 MB read cap. There is no distributed transaction across repositories: revocation can race an already-authorized cross-repository write. Repository/discussion enumeration is bounded.
- Git history and backups retain prior private data; deleting a current record does not erase historical copies. Define archival, retention and deletion procedures before collecting substantial personal material.
- Only valid App-authored signed discussion envelopes render as scientific discussion. Back up private Issues and contents together and protect signing-secret continuity.
- Contribution/citation/archive/distribution details remain unresolved where absent in the research packages. Website checks do not document human scientific approval. No repository license or author attribution is assigned by this README.

See [operations and limits](docs/DEPLOYMENT.md#operations-and-limits) for implementation details and dated measurements. Keep private operational records and correspondence out of public documentation.
