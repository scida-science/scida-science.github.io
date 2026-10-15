# Repository-backed investigation content

The `discovery.json` v1 contract supports optional `question`,
`headlineFigureId`, `headlineResult`, `figures` and `statusHistory` fields inside `discovery`.
Existing active repositories without these fields continue to render. The schema is
[discovery.schema.json](discovery.schema.json).

## Placement

- The scrolling page uses title, question, summary, status, reviewNote and the
  figure identified by headlineFigureId. Its existing card links to
  `/discoveries/{id}` (the deployed hash URL is `/#/discoveries/{id}`).
- The detail page uses sections in their recorded order. Each figure has an id,
  repository-relative PNG path, caption, alt text and sectionId. The sectionId
  must match an existing section. Paragraph breaks are retained.
- Theory can use `headlineResult: { equation, caption }` for a mathematical
  statement on the scrolling page. Use short display-math rows and state the
  assumptions and symbol meanings in the caption. Section bodies support
  Markdown links and inline/display mathematics through the same safe renderer
  as discussions. Standalone section `equation` fields remain supported.
- Full papers and downloads use the existing top-level materials map. The
  compatibility map inside discovery remains all-null. Reuse one paper path
  for an appendix contained in that paper; leave appendix null if none exists.
- Keep provenance and internal claim maps outside discovery.json. Do not list
  internal notes in materials or figures. The API projects known brief fields
  and serves only explicitly listed material/figure IDs; it has no generic
  repository-file endpoint.

The selected inline figures share the brief's visibility. Signed-in briefs
require a valid session even for their figure endpoint. The browser fetches
images with the existing SciDA session mechanism and uses revocable object
URLs, without putting credentials in an image URL. The Worker accepts only PNG
signatures, limits inline images to 16 MiB, and sets no-store/nosniff headers.
Other downloads retain the existing attachment-only transport and per-material
access policies. Figure paths remain repository-managed when text is edited
through the browser.

## Content and validation conventions

Summaries should distinguish measurements, conditional model results and
interpretations. `Validated` is not an automatic consequence of passing
software checks. State the scope, date and location of any independent checks,
and distinguish independent implementations from independent observations or
human scientific approval. Do not infer novelty from reproducibility.

Keep named contributions faithful to the manuscript or another documented
record. Missing disclosures should remain explicit. Code requests use the
existing sign-in and administrator workflow; submitting one does not grant
access or establish an open-source license.

## Archive and decision history

Active statuses are `Awaiting Validation`, `Validated`, and `Published`.
Archived outcomes are `Not supported` (insufficient supporting evidence),
`Refuted` (evidence demonstrates the claim is incorrect), and `Withdrawn`
(an investigation withdrawn with an explanation). The website separates these
records into Archive while retaining their stable IDs, full briefs, supporting
materials, discussion and follow preferences. Material access and topic review
permissions remain unchanged; do not use GitHub's repository-archive switch for
this workflow, because SciDA must still read and update the investigation.

Only the verified owner Admin can change status through SciDA. The editor sends
the requested status and a `statusChangeReason` (10–2,000 characters); this is
an API input, not a field to store in `discovery.json`. The Worker appends a
decision to `discovery.statusHistory`, recording `from`, `to`, `reason`,
`decidedAt`, `decidedBy` (numeric GitHub user ID), `decidedByName`, and `version`.
Decisions and reasons are public wherever the brief is visible, so they must
not contain private correspondence or personal contact details.

History is chronological, continuous and append-only through the API. The last
decision's `to` matches the current status. Archived records require a valid
history; legacy active records may omit it. A restoration appends another
decision with an active destination status and a new explanation. Browser
submissions cannot forge, replace or remove earlier decisions. At 100 retained
decisions, further status transitions are rejected rather than truncating the
record; content edits remain available. GitHub revision checks prevent stale
forms from overwriting a concurrent edit. Repository owners can still edit files
directly on GitHub, so this is not a tamper-proof external audit ledger.

The content-preparation validator uses the JSON Schema and the Worker's runtime
checks, verifies relative asset/material paths, mathematical statements and PNG
signatures. When an internal manifest/claim-map pair exists, it also verifies
file hashes and resolves its JSON Pointers:

```sh
node scripts/validate-discovery.mjs /path/to/discovery-repository
```

For the prepared packages, `internal/source-manifest.json` contains the original
scientific-package paths and SHA-256 values of retained evidence snapshots.
`internal/claims.json` maps public JSON Pointers to manuscript sections and these
snapshots. The validator checks all listed snapshots without exposing them to
the frontend. A compact website evidence selection is not a complete executable
research bundle.

These optional traceability files are retained for the astronomy packages.
A research repository containing the actual paper, code and results does not
need duplicate evidence snapshots or an additional audit-document hierarchy.
If either traceability file is present, both are required and checked.

Compact reviewer packages can use the ordinary single-file material transport:
`{ "path": "reviewer/information-optimal-bandits-reviewer.zip", "access": "reviewer" }`.
This uses the same topic approval and download authorization as larger packages.
Absent materials are hidden, and a theory-only record without a package has no
code-request control.

## Approved reviewer packages

The complete packages are prepared locally under `reviewer/`. Numbered archive
parts are uploaded as assets of a private draft release, rather than Git blobs.
Small package manifests and reproduction helpers remain in the investigation
repository. The existing `repository` material can use
`{ "path": "reviewer/package.json", "access": "reviewer", "format": "multipart-zip" }`.
Other materials and their access levels remain unchanged. This uses existing
topic-review approval; a code request alone grants no permission.

The package manifest records `schemaVersion: 1`, the joined archive's `filename`,
`size`, `sha256`, and `files`. Each file declares `id`, repository-relative `path`,
`size`, and `sha256`. Release-backed files also declare a positive integer
`releaseAssetId`, belonging to the same private investigation repository. Files include the reviewer README, a standard-library Python
assembly helper, the archive index and ZIP parts of at most 48 MiB. Every path
must remain inside the manifest's `reviewer/` directory. The content validator
checks every declared file's size and hash without loading the whole archive.

The ordinary material endpoint returns an authorized file list. Its
`/files/{fileId}` child endpoint rechecks the same material permission before
streaming a declared file. IDs do not allow arbitrary repository-file access.
For release assets, the Worker checks the asset name, size and available GitHub
digest, then streams the asset without buffering it. It follows only a GitHub
asset-CDN redirect, without forwarding the installation token. Neither that
signed URL nor GitHub credentials are returned to the browser.
The UI verifies bytes before saving, and the assembly helper verifies the joined
archive and safe paths before extracting the original research tree. Full inputs
and retained results stay behind reviewer access; they do not enter public brief
fields or the reader-access selected-evidence ZIP.

See the [website README](../README.md#complete-reviewer-packages) for preparation,
download and update commands. Keep the investigation README focused on verifying
the analysis, rather than these integration details.

## Release boundary

Prepare repository content and this matching frontend/backend support on
dedicated branches. A content-only branch or local commit does not publish
anything. The live Worker reads discovery repositories' default branches, so
merging content there can expose it immediately. Deployment and default-branch
merges must be separate, explicitly requested actions. Release the matching
frontend/backend support before enabling metadata with the new figure fields.

The public website repository contains generic rendering, schema and validation
code only. Keep private paper PDFs, research data and internal traceability in
the private investigation repositories.
