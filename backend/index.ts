import { configured, type Env } from "./env";
import { createAuth } from "./auth";
import { GitHubApi, GitHubRepositoryStore } from "./github";
import { createDomain } from "./domain";
import { HttpError, object, type GitHubStore } from "./model";

const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new HttpError(415, "Send a JSON request.");
  if (Number(request.headers.get("Content-Length")) > 100_000)
    throw new HttpError(413, "The submission is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "A JSON request body is required.");
  let text = "",
    size = 0;
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 100_000) {
      await reader.cancel();
      throw new HttpError(413, "The submission is too large.");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    const value = JSON.parse(text);
    if (!object(value)) throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "Send a valid JSON object.");
  }
}

// Dependency injection is used only by tests; deployed requests always use the GitHub App.
export async function handleRequest(
  request: Request,
  env: Env,
  suppliedStore?: GitHubStore,
): Promise<Response> {
  const origin = request.headers.get("Origin");
  let response: Response;
  try {
    if (origin && origin !== env.FRONTEND_ORIGIN)
      throw new HttpError(403, "This website origin is not allowed.");
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": env.FRONTEND_ORIGIN,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "600",
          Vary: "Origin",
        },
      });
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET")
      return json({
        service: "SciDA GitHub backend",
        configured: configured(env),
      });
    if (!configured(env))
      throw new HttpError(
        503,
        "GitHub account services are not configured yet.",
      );
    const store =
      suppliedStore ?? new GitHubRepositoryStore(new GitHubApi(env));
    const auth = createAuth(store, env);
    if (request.method === "GET" && path === "/auth/start")
      return await auth.start(request);
    if (request.method === "GET" && path === "/auth/callback")
      return await auth.callback(request);
    if (request.method === "POST" && origin !== env.FRONTEND_ORIGIN)
      throw new HttpError(
        403,
        "A matching website origin is required for submissions.",
      );
    if (path === "/auth/exchange" && request.method === "POST")
      response = json(await auth.exchange(await body(request)));
    else if (path === "/auth/logout" && request.method === "POST") {
      await auth.logout(request);
      response = json({ ok: true, message: "Signed out." });
    } else {
      const userId = await auth.authenticate(request),
        domain = createDomain(store, env.ADMIN_GITHUB_ID, env.API_ORIGIN);
      let parts: string[];
      try {
        parts = path
          .split("/")
          .filter(Boolean)
          .map((part) => decodeURIComponent(part));
      } catch {
        throw new HttpError(400, "The requested URL is malformed.");
      }
      if (path === "/v1/portal" && request.method === "GET")
        response = json(await domain.portal(userId));
      else if (
        parts.length === 5 && parts[0] === "v1" && parts[1] === "discoveries" &&
        parts[3] === "evidence" && request.method === "GET"
      ) {
        const { record, figure } = await domain.authorizeFigure(userId, parts[2], parts[4]);
        if (!(store instanceof GitHubRepositoryStore))
          throw new HttpError(501, "Figure transport is unavailable in this test adapter.");
        response = await store.figureFile(record, figure.path);
      }
      else if (
        (parts.length === 5 || (parts.length === 7 && parts[5] === "files")) &&
        parts[0] === "v1" &&
        parts[1] === "discoveries" &&
        parts[3] === "materials" &&
        request.method === "GET"
      ) {
        const { record, material } = await domain.authorizeMaterial(
          userId,
          parts[2],
          parts[4],
        );
        if (parts.length === 7 && material.format !== "multipart-zip")
          throw new HttpError(404, "Package file not found.");
        if ("url" in material) response = json({ url: material.url });
        else if (store instanceof GitHubRepositoryStore) {
          if (material.format === "multipart-zip") {
            const manifest = await store.reviewerPackage(record, material.path);
            if (parts.length === 7) {
              const file = manifest.files.find((candidate) => candidate.id === parts[6]);
              if (!file) throw new HttpError(404, "Package file not found.");
              response = await store.packageFile(record, file);
            } else {
              const base = `${env.API_ORIGIN.replace(/\/$/, "")}/v1/discoveries/${encodeURIComponent(parts[2])}/materials/${encodeURIComponent(parts[4])}/files/`;
              response = json({ package: {
                filename: manifest.filename, size: manifest.size, sha256: manifest.sha256,
                files: manifest.files.map((file) => ({
                  id: file.id, filename: file.path.split("/").at(-1)!, size: file.size,
                  sha256: file.sha256, url: base + encodeURIComponent(file.id),
                })),
              } });
            }
          } else response = await store.materialFile(record, material.path);
        } else
          throw new HttpError(
            501,
            "Material transport is unavailable in this test adapter.",
          );
      } else {
        if (request.method !== "POST")
          throw new HttpError(404, "This endpoint does not exist.");
        if (!userId)
          throw new HttpError(401, "Sign in with GitHub to continue.");
        const input = await body(request);
        let extra: Record<string, unknown> = {};
        if (path === "/v1/profile")
          await domain.saveProfile(userId, input.input);
        else if (path === "/v1/applications")
          await domain.applyForReview(userId, input.topics, input.evidence);
        else if (
          parts.length === 4 &&
          parts[0] === "v1" &&
          parts[1] === "applications" &&
          parts[3] === "decision"
        ) {
          if (
            typeof input.decision !== "string" ||
            !["Approved", "Declined"].includes(input.decision)
          )
            throw new HttpError(400, "Choose an approval decision.");
          await domain.reviewApplication(
            userId,
            parts[2],
            input.decision === "Approved",
            input.note,
          );
        } else if (path === "/v1/invitations") {
          const invitation = await domain.createInvitation(
            userId,
            input.topics,
            input.intendedEmail,
          );
          extra = { invitation, code: invitation.code };
        } else if (path === "/v1/invitations/preview")
          extra = {
            invitation: await domain.previewInvitation(userId, input.code),
          };
        else if (path === "/v1/invitations/accept")
          await domain.acceptInvitation(
            userId,
            input.code,
            input.confirmedTopics,
          );
        else if (path === "/v1/comments")
          await domain.addComment(userId, input.input);
        else if (path === "/v1/code-requests")
          await domain.requestCode(
            userId,
            input.discoveryId,
            input.explanation,
          );
        else if (
          parts.length === 4 &&
          parts[0] === "v1" &&
          parts[1] === "discoveries" &&
          parts[3] === "follow"
        )
          await domain.setFollowing(userId, parts[2], input.following);
        else if (
          parts.length === 3 &&
          parts[0] === "v1" &&
          parts[1] === "discoveries"
        ) {
          if (!object(input.discovery) || input.discovery.id !== parts[2])
            throw new HttpError(400, "The discovery ID must match its page.");
          await domain.updateDiscovery(userId, input.discovery);
        } else if (
          parts.length === 3 &&
          parts[0] === "v1" &&
          parts[1] === "access"
        )
          await domain.setAccess(
            userId,
            parts[2],
            input.role,
            input.approvedTopics,
            input.assignedTopics,
          );
        else throw new HttpError(404, "This endpoint does not exist.");
        response = json({ ok: true, message: "Saved to GitHub.", ...extra });
      }
    }
  } catch (error) {
    // Never echo GitHub response bodies, request URLs, OAuth codes, tokens or keys.
    response = json(
      {
        ok: false,
        message:
          error instanceof HttpError
            ? error.message
            : "GitHub storage could not complete this request. Please try again.",
      },
      error instanceof HttpError ? error.status : 503,
    );
  }
  if (origin === env.FRONTEND_ORIGIN) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
    response.headers.set(
      "Access-Control-Expose-Headers",
      "Content-Disposition",
    );
  }
  return response;
}
export default {
  fetch: (request: Request, env: Env) => handleRequest(request, env),
};
