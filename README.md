# SciDA — Scientific Discovery Agent

A React, TypeScript, and Vite research portal with Supabase email authentication, shared PostgreSQL storage, and topic-specific reviewer approval. The academic design and six clearly labeled illustrative discoveries are preserved. The placeholders are not real findings, validations, or publications.

Repository: [scida-science/scida-science.github.io](https://github.com/scida-science/scida-science.github.io)

Website: [scida-science.github.io](https://scida-science.github.io/)

## Run on Windows

Node.js 24 and npm are used locally and in CI. In PowerShell:

```powershell
Set-Location (Join-Path ([Environment]::GetFolderPath('Desktop')) 'SciDA-website')
npm.cmd ci
Copy-Item .env.example .env.local
# Add the two public Supabase connection values to .env.local when available.
npm.cmd run dev
```

Open Vite's printed address, normally `http://127.0.0.1:5173/`. Resolving Desktop through Windows accommodates OneDrive redirection. Restart Vite after changing environment variables.

```powershell
npm.cmd test
npm.cmd run test:db
npm.cmd run build
npm.cmd run preview
```

The build is in `dist/`; preview normally serves `http://127.0.0.1:4173/`. Stop a local server with `Ctrl+C`.

## Connect Supabase

Without a configured backend, visitors can read the six bundled placeholders, but account and submission services explicitly remain unavailable. There is no simulated authentication, persona selector, browser data store, or fake successful submission. A configured backend that fails to respond displays an error instead of substituting example account data.

Minimum setup for an existing or new Supabase project:

1. Apply `supabase/migrations/202610140001_scida.sql`, then `supabase/migrations/202610140002_placeholder_discoveries.sql`, in the SQL Editor as the project owner. Alternatively use your normal Supabase migration process. Inspect any existing schema first; these migrations deliberately do not overwrite conflicting tables.
2. Enable email/password authentication and email confirmation. Set the Auth Site URL to `https://scida-science.github.io/`. Allow both `https://scida-science.github.io/` and `https://scida-science.github.io/?recovery=1` as redirect URLs. For development also allow `http://127.0.0.1:5173/` and `http://127.0.0.1:5173/?recovery=1`.
3. Obtain the project URL and **publishable key**. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` locally. A legacy `anon` key is also supported. Never use a secret or `service_role` key.
4. Set the same two names as GitHub repository **Actions variables** in Settings → Secrets and variables → Actions → Variables. Rerun **Build and deploy SciDA**. These public connection settings are embedded in the bundle; privileged credentials do not belong here.
5. Register your owner account, confirm its email, and perform the initial-admin procedure below.

The application uses PKCE email authentication. Open confirmation and recovery links in the same browser that initiated the request. The root callback consumes `?code=...` before loading account data, avoiding a collision with GitHub Pages hash routes. If a link expires or is opened elsewhere, request a fresh email instead of copying tokens.

The build rejects incomplete settings, malformed URLs, and privileged keys before bundling. An entirely unconfigured build is allowed so the public placeholder website can be published while backend setup is pending.

Before wider registration, configure an email sender and review Auth rate limits and abuse protection. Official references: [password authentication](https://supabase.com/docs/guides/auth/passwords), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), and [API keys](https://supabase.com/docs/guides/api/api-keys).

## Assign the initial administrator

Admin access never comes from profile edits, signup metadata, browser settings, or a role selector.

1. Register normally and verify your email.
2. Find your confirmed account under Supabase Authentication → Users. Copy its UUID and exact email.
3. Open `supabase/bootstrap-admin.sql` in the SQL Editor and replace the UUID and email placeholders. Optionally specify your approved discussion topics if you will also act as a reviewer.
4. Run it as the project database owner. It verifies the UUID/email match and email confirmation, refuses to run if an admin already exists, and records the action in the access audit.
5. Refresh the website to load the database-assigned role.

There is at most one initial administrator. The public API cannot create, replace, or demote an admin. Later administrative recovery must be performed deliberately by the Supabase project owner outside the frontend.

## Permissions and shared data

A database trigger gives new Auth accounts a profile and **Reader** access. Client-provided role metadata is ignored.

- Visitors and Readers can read discoveries and public discussions. Confirmed account holders can maintain their own profile, submit reviewer evidence, and request code.
- Discussion contributions require an approved topic matching the discovery. Administrative or approval responsibility alone does not confer scientific review expertise.
- Approvers decide other researchers' applications and issue invitations only within assigned topics. They cannot appoint approvers or administrators.
- The administrator can edit discoveries and statuses, manage review access, appoint approvers, and inspect code requests. Email is an Auth identity field, not a client-editable privilege.
- Invitations bind to a verified recipient email, expire after seven days, are single use, and require explicit confirmation of the exact topic scope. The database stores only a hash of the random code. The raw code is returned once to the creator for private delivery; no invitation email is automatically sent.
- Private profiles and evidence are visible only to the owner, administrator, and appropriately scoped approvers. Public discussion attribution exposes only author names.
- New threads use the current manuscript version. Replies retain their parent discovery and version. Historical manuscript files are not archived automatically.

RLS, column grants, and narrowly scoped database functions enforce these rules. Roles and approved/assigned topics cannot be directly changed by website users. Approval and invitation functions check the caller and use an empty `search_path`. The migration removes default grants before applying explicit privileges. See [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

Profiles, comments, code requests, applications, invitations, and topic grants live in Supabase. The old `scida.demo.v1` browser store is never read or imported. Supabase's SDK persists its authentication session; server policies remain authoritative. No fabricated accounts, discussions, or approval decisions are seeded into the hosted database. Test identities exist only in isolated local test fixtures.

## Editing and source layout

- `src/data/discoveries.ts`: typed placeholder briefs and topics. Missing materials display “Not uploaded yet”; add links only when real files exist.
- `supabase/migrations/`: schema, access controls, and placeholder-only seeds. Once connected, discoveries come from Supabase. Editing the bundled file alone does not update the database; use the admin editor or a reviewed new migration.
- `src/lib/supabase.ts`: public connection configuration and client creation.
- `src/services/`: Auth callbacks, remote data access, validation, and application operations.
- `src/state/PortalContext.tsx`: React integration with the account/data service.
- `src/pages/`, `src/components/`, `src/styles.css`: interface and preserved responsive academic design.
- `supabase/bootstrap-admin.sql`: controlled initial administrator setup.

Keep discovery IDs stable; advance the manuscript version when research changes. Google Scholar is optional and manually supplied, without scraping. Profile topic choices depend on selected research fields.

There is no `writing_style/` directory in this project. The illustrative briefs retain their original wording; no other project's reference-paper style was applied.

## GitHub Pages

The organization homepage repository is `scida-science/scida-science.github.io`. Vite uses `base: '/'`. `HashRouter` supports refreshable addresses such as:

```text
https://scida-science.github.io/#/discoveries/AI-001
```

The server receives a root HTML request when these routes are refreshed. Auth callbacks also use the root, with query parameters before hash navigation. If moving to a project subpath, update Vite's base, Supabase Site URL, and allowed redirects together.

`.github/workflows/deploy.yml` installs locked dependencies, runs frontend/service and PostgreSQL policy tests, builds, uploads `dist/`, and deploys through the `github-pages` environment. Pull requests run checks without deploying; main-branch pushes and manual dispatches deploy. Pages must use **GitHub Actions** as the publishing source. Deployment permissions are restricted to the deployment job. See [GitHub's Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Only source, migrations, tests, and public assets belong in Git. Environment files, credentials, keys, database exports, dependencies, build output, and local Supabase state are ignored. Never put privileged credentials in `VITE_` variables.

## Verification

`npm test` covers real-account service contracts with mocks, unavailable/error states, navigation, and form behavior. These tests do not claim a hosted connection.

`npm run test:db` runs the actual migrations in an isolated PGlite PostgreSQL engine, supplies local Auth fixtures, switches database roles, and attempts permitted and forbidden operations. It covers discussion scopes, profile privacy, self-escalation, admin restrictions, invitation confirmation, revocation, and bootstrap. Fixtures are not production migrations. This validates PostgreSQL policy behavior, not hosted Supabase Auth/email delivery.

After connecting a project, use an existing confirmed Reader for the opt-in live check:

```powershell
# Set these in your local process environment; never commit account credentials:
# VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
# SCIDA_TEST_READER_EMAIL, SCIDA_TEST_READER_PASSWORD
npm.cmd run test:backend
```

The live check signs in with Supabase, verifies profile write/reread persistence, and attempts protected account/topic/status operations. It does not seed users or use a privileged key. Verify email confirmation/recovery in a real browser and shared visibility across separate sessions before inviting researchers.

Record desktop/mobile visual checks and hosted login separately from build and simulated-DOM tests. A deployed site with missing Supabase settings is a public placeholder portal, not a fully functional account system.
