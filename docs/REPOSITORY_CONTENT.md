# Repository-backed investigation content

The existing `discovery.json` v1 contract now has three optional fields inside
`discovery`: `question`, `headlineFigureId` and `figures`. Existing repositories
without these fields continue to render. The schema is
[discovery.schema.json](discovery.schema.json).

## Placement

- The scrolling page uses title, question, summary, status, reviewNote and the
  figure identified by headlineFigureId. Its existing card links to
  `/discoveries/{id}` (the deployed hash URL is `/#/discoveries/{id}`).
- The detail page uses sections in their recorded order. Each figure has an id,
  repository-relative PNG path, caption, alt text and sectionId. The sectionId
  must match an existing section. Paragraph breaks are retained.
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

The content-preparation validator uses the JSON Schema and the Worker's runtime
checks, verifies relative asset/material paths, PNG signatures and file hashes,
and resolves the internal claim map's JSON Pointers:

```sh
node scripts/validate-discovery.mjs /path/to/discovery-repository
```

For the prepared packages, `internal/source-manifest.json` contains the original
scientific-package paths and SHA-256 values of retained evidence snapshots.
`internal/claims.json` maps public JSON Pointers to manuscript sections and these
snapshots. The validator checks all listed snapshots without exposing them to
the frontend. A compact website evidence selection is not a complete executable
research bundle.

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
