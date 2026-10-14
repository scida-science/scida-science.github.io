// Regenerate the initial migration before first deployment only.
// For an already migrated project, create a NEW migration or edit via the admin UI.
import fs from "node:fs/promises";
import ts from "typescript";

const input = await fs.readFile(
  new URL("../src/data/discoveries.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(input, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
});
const { discoveries } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const rows = discoveries.map((d) =>
  [
    d.id,
    d.title,
    d.field,
    d.topic,
    d.status,
    d.summary,
    d.updatedAt,
    d.version,
    d.reviewNote,
    JSON.stringify(d.sections),
    JSON.stringify(d.materials),
  ]
    .map(quote)
    .concat("true")
    .join(", "),
);
const sql = `-- Six illustrative research briefs only. No real findings or identities.\n-- Generated from src/data/discoveries.ts; never seed browser demo state.\nbegin;\ninsert into public.discoveries\n  (id,title,field,topic,status,summary,updated_at,version,review_note,sections,materials,illustrative)\nvalues\n  (${rows.join("),\n  (")})\non conflict (id) do nothing;\ncommit;\n`;
await fs.writeFile(
  new URL(
    "../supabase/migrations/202610140002_placeholder_discoveries.sql",
    import.meta.url,
  ),
  sql,
);
console.log(`Generated ${discoveries.length} illustrative discovery records.`);
