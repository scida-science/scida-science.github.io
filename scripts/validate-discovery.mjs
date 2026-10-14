import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { build } from "esbuild";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(await readFile(resolve(root, "docs/discovery.schema.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);
// Reuse the deployed semantic checks as well as the published JSON Schema.
const bundled = await build({ entryPoints: [resolve(root, "backend/domain.ts")], bundle: true, platform: "node", format: "esm", write: false });
const { validDiscoveryDocument } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const targets = process.argv.slice(2);
if (!targets.length) throw new Error("Usage: node scripts/validate-discovery.mjs <repository> [...repositories]");
const ids = new Set();
for (const target of targets) {
  const repo = await realpath(resolve(target));
  const doc = JSON.parse(await readFile(resolve(repo, "discovery.json"), "utf8"));
  if (!validateSchema(doc)) throw new Error(`${repo}: ${ajv.errorsText(validateSchema.errors, { separator: "\n" })}`);
  if (!validDiscoveryDocument(doc)) throw new Error(`${repo}: invalid semantic links or metadata`);
  if (ids.has(doc.discovery.id)) throw new Error(`Duplicate ID: ${doc.discovery.id}`);
  ids.add(doc.discovery.id);
  if (Object.values(doc.discovery.materials).some((v) => v !== null))
    throw new Error("Repository compatibility material slots must be null");
  async function checkedFile(path) {
    const actual = await realpath(resolve(repo, path));
    const rel = relative(repo, actual);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\"))
      throw new Error(`Path escapes repository: ${path}`);
    if (!(await stat(actual)).isFile()) throw new Error(`Not a file: ${path}`);
    return readFile(actual);
  }
  for (const material of Object.values(doc.materials)) {
    if (material?.path) {
      if (material.path.startsWith("internal/")) throw new Error("Internal evidence must not be exposed as a material");
      await checkedFile(material.path);
    }
  }
  for (const figure of doc.discovery.figures ?? []) {
    if (figure.path.startsWith("internal/")) throw new Error("Internal evidence must not be exposed as a figure");
    const bytes = await checkedFile(figure.path);
    if (bytes.length > 16 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
      throw new Error(`Invalid or oversized PNG: ${figure.path}`);
  }
  const manifestPath = resolve(repo, "internal/source-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const claims = JSON.parse(await readFile(resolve(repo, "internal/claims.json"), "utf8"));
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  for (const record of [manifest.paper, ...manifest.files, ...claims.figures]) {
    if (digest(await checkedFile(record.path)) !== record.sha256) throw new Error(`Hash mismatch: ${record.path}`);
  }
  for (const claim of claims.claims) {
    if (!claim.manuscriptSections.length || !claim.evidence.length) throw new Error(`Claim lacks provenance: ${claim.id}`);
    for (const pointer of claim.publicLocations) {
      let value = doc;
      if (!pointer.startsWith("/")) throw new Error(`Invalid claim location: ${pointer}`);
      for (const part of pointer.slice(1).split("/")) value = value?.[part.replaceAll("~1", "/").replaceAll("~0", "~")];
      if (value === undefined) throw new Error(`Unresolved claim location: ${pointer}`);
    }
    for (const evidence of claim.evidence) {
      if (digest(await checkedFile(evidence.path)) !== evidence.sha256) throw new Error(`Claim evidence mismatch: ${claim.id}`);
    }
  }
  if (doc.discovery.illustrative || doc.discovery.status !== "Awaiting Validation")
    throw new Error("This preparation requires real investigations awaiting validation");
  console.log(`${doc.discovery.id}: schema, semantic links, ${doc.discovery.figures?.length ?? 0} PNGs, materials and ${claims.claims.length} traced claims passed`);
}
