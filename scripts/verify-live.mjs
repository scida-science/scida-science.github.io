// Read-only deployment smoke checks. No account, session, or repository writes.
// Usage: node scripts/verify-live.mjs [--require-configured]
// Optional environment variable: SCIDA_API_URL (an HTTPS origin).
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const requireConfigured = process.argv.includes("--require-configured");
if (process.argv.slice(2).some((arg) => arg !== "--require-configured")) {
  console.error("Usage: node scripts/verify-live.mjs [--require-configured]");
  process.exit(1);
}
let api;
try {
  api = new URL(
    process.env.SCIDA_API_URL || "https://scida-api.scida-website.workers.dev",
  );
  assert(
    api.protocol === "https:" &&
      !api.username &&
      !api.password &&
      api.pathname === "/" &&
      !api.search &&
      !api.hash,
  );
} catch {
  console.error("SCIDA_API_URL must be an HTTPS origin without credentials or a path.");
  process.exit(1);
}
const frontend = "https://scida-science.github.io";
let failures = 0;
let requests = 0;

async function request(path, options = {}) {
  const started = performance.now();
  const response = await fetch(new URL(path, api), {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  // Never print response bodies: even a failing deployment could expose private data.
  const raw = await response.text();
  requests += 1;
  console.log(
    `${options.method || "GET"} ${path}: HTTP ${response.status}, ${Math.round(performance.now() - started)} ms wall latency`,
  );
  assert(raw.length <= 5_000_000, "Response exceeded the smoke-check size limit.");
  let body;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Error("Expected a JSON API response.");
    }
  }
  return { response, body };
}

async function check(name, run) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch {
    // Assertion details may include payload values; deliberately omit them.
    failures += 1;
    console.error(`FAIL ${name}`);
  }
}

function exactKeys(value, keys) {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

function noProtectedKeys(value) {
  if (Array.isArray(value)) return value.forEach(noProtectedKeys);
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(!/secret|token|password|privatekey|email|githublogin|sessions|exchanges|audit|assignedtopics|approvedtopics/i.test(key));
    noProtectedKeys(child);
  }
}

let configured;
await check("health exposes only service readiness", async () => {
  const { response, body } = await request("/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  exactKeys(body, ["service", "configured"]);
  assert.equal(body.service, "SciDA GitHub backend");
  assert.equal(typeof body.configured, "boolean");
  configured = body.configured;
});

await check("frontend preflight is explicitly allowed", async () => {
  const { response } = await request("/v1/profile", {
    method: "OPTIONS",
    headers: {
      Origin: frontend,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type, Authorization",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), frontend);
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
});

await check("hostile-origin submission is rejected before any data access", async () => {
  const { response, body } = await request("/v1/profile", {
    method: "POST",
    headers: { Origin: "https://untrusted.invalid", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  exactKeys(body, ["ok", "message"]);
  assert.equal(body.ok, false);
});

if (typeof configured === "boolean") {
  await check(
    configured ? "public portal reads GitHub without exposing account records" : "unconfigured portal honestly returns 503",
    async () => {
      const { response, body } = await request("/v1/portal", { headers: { Origin: frontend } });
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), frontend);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      if (!configured) {
        assert.equal(response.status, 503);
        exactKeys(body, ["ok", "message"]);
        assert.equal(body.ok, false);
        return;
      }
      assert.equal(response.status, 200);
      exactKeys(body, ["state", "user"]);
      assert.equal(body.user, null);
      exactKeys(body.state, ["profiles", "discoveries", "comments", "codeRequests", "applications", "invitations"]);
      for (const key of ["profiles", "codeRequests", "applications", "invitations"])
        assert.deepEqual(body.state[key], []);
      noProtectedKeys(body);
      assert(Array.isArray(body.state.discoveries));
      assert(Array.isArray(body.state.comments));
      const ids = new Set();
      for (const discovery of body.state.discoveries) {
        assert.equal(typeof discovery.id, "string");
        assert.match(discovery.id, /^[a-zA-Z0-9_-]+$/);
        assert(!ids.has(discovery.id));
        ids.add(discovery.id);
        assert(["Astronomy", "Artificial Intelligence"].includes(discovery.field));
        assert(["Awaiting Validation", "Validated", "Published", "Not supported", "Refuted", "Withdrawn"].includes(discovery.status));
        if (["Not supported", "Refuted", "Withdrawn"].includes(discovery.status)) {
          assert(Array.isArray(discovery.statusHistory) && discovery.statusHistory.length > 0);
          assert.equal(discovery.statusHistory.at(-1).to, discovery.status);
        }
        assert(Number.isFinite(Date.parse(discovery.updatedAt)));
        exactKeys(discovery.materials, ["paper", "appendix", "figures", "data", "repository"]);
        for (const [kind, value] of Object.entries(discovery.materials)) {
          if (value !== null)
            assert.equal(value, `${api.origin}/v1/discoveries/${encodeURIComponent(discovery.id)}/materials/${kind}`);
        }
      }
      console.log(`Public records: ${ids.size} unique discoveries; ${body.state.comments.length} discussion entries.`);
      // Counts may legitimately change as the owner publishes new research.
    },
  );
}

if (configured) {
  await check("malformed bearer credentials are rejected", async () => {
    const { response, body } = await request("/v1/portal", {
      headers: { Origin: frontend, Authorization: "Bearer invalid-live-verification" },
    });
    assert.equal(response.status, 401);
    exactKeys(body, ["ok", "message"]);
    assert.equal(body.ok, false);
  });
  await check("anonymous administrative submissions are rejected without writes", async () => {
    const { response, body } = await request("/v1/access/not-a-user", {
      method: "POST",
      headers: { Origin: frontend, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 401);
    exactKeys(body, ["ok", "message"]);
    assert.equal(body.ok, false);
  });
} else {
  console.log("SKIP authenticated checks: GitHub App configuration is incomplete or health could not be confirmed.");
  if (requireConfigured) {
    failures += 1;
    console.error("FAIL --require-configured requires a configured backend.");
  }
}

console.log(`${requests} HTTP requests; ${failures} failed checks. Timings are wall latency, not Worker CPU measurements.`);
console.log("These checks do not verify real sign-in, signed-in role enforcement, profile persistence, or discussion posting.");
process.exitCode = failures ? 1 : 0;
