import type { Env } from "./env";
import { digest, randomToken, seal, unseal } from "./crypto";
import { HttpError, object, type GitHubStore } from "./model";
import type { Fetcher } from "./github";

const opaque = /^[A-Za-z0-9_-]{43}$/;
const verifierPattern = /^[A-Za-z0-9._~-]{43,128}$/;
const cookieName = "scida_oauth";
interface OAuthAttempt {
  state: string;
  verifier: string;
  challenge: string;
  clientState: string;
  expires: number;
}
const cookie = (value: string, env: Env, clear = false) =>
  `${cookieName}=${value}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 600}${env.API_ORIGIN.startsWith("https:") ? "; Secure" : ""}`;

function prune(records: Record<string, { expiresAt: string }>) {
  for (const [key, record] of Object.entries(records))
    if (
      !Number.isFinite(Date.parse(record.expiresAt)) ||
      Date.parse(record.expiresAt) <= Date.now()
    )
      delete records[key];
}

export function createAuth(
  store: GitHubStore,
  env: Env,
  fetcher: Fetcher = fetch,
) {
  async function start(request: Request): Promise<Response> {
    const url = new URL(request.url),
      challenge = url.searchParams.get("challenge") || "",
      clientState = url.searchParams.get("state") || "";
    if (!opaque.test(challenge) || !opaque.test(clientState))
      throw new HttpError(
        400,
        "A valid sign-in challenge and state are required.",
      );
    const attempt: OAuthAttempt = {
      state: randomToken(),
      verifier: randomToken(),
      challenge,
      clientState,
      expires: Date.now() + 600_000,
    };
    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.search = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      redirect_uri: env.API_ORIGIN + "/auth/callback",
      state: attempt.state,
      code_challenge: await digest(attempt.verifier),
      code_challenge_method: "S256",
      allow_signup: "true",
    }).toString();
    return new Response(null, {
      status: 302,
      headers: {
        Location: authorize.href,
        "Set-Cookie": cookie(await seal(attempt, env.SESSION_SECRET), env),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  async function callback(request: Request): Promise<Response> {
    const destination = new URL(env.FRONTEND_ORIGIN);
    const params = new URLSearchParams();
    try {
      const cookies = request.headers.get("cookie") || "";
      const value = cookies
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(cookieName + "="))
        ?.slice(cookieName.length + 1);
      if (!value)
        throw new HttpError(
          401,
          "The sign-in request expired. Start again in the same browser.",
        );
      let decoded: unknown;
      try {
        decoded = await unseal(value, env.SESSION_SECRET);
      } catch {
        throw new HttpError(
          401,
          "The sign-in request is invalid. Start again.",
        );
      }
      if (
        !object(decoded) ||
        typeof decoded.expires !== "number" ||
        decoded.expires < Date.now() ||
        typeof decoded.state !== "string" ||
        typeof decoded.clientState !== "string" ||
        typeof decoded.challenge !== "string" ||
        typeof decoded.verifier !== "string"
      )
        throw new HttpError(401, "The sign-in request expired. Start again.");
      const attempt = decoded as unknown as OAuthAttempt,
        url = new URL(request.url);
      params.set("state", attempt.clientState);
      if (url.searchParams.get("state") !== attempt.state)
        throw new HttpError(
          401,
          "GitHub sign-in state did not match. Start again.",
        );
      if (url.searchParams.has("error"))
        throw new HttpError(401, "GitHub authorization was not completed.");
      const code = url.searchParams.get("code");
      if (!code || code.length > 512)
        throw new HttpError(
          401,
          "GitHub did not provide a valid authorization code.",
        );
      const tokenResponse = await fetcher(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          redirect: "error",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: env.API_ORIGIN + "/auth/callback",
            code_verifier: attempt.verifier,
          }),
        },
      );
      const token = (await tokenResponse.json()) as { access_token?: string };
      if (!tokenResponse.ok || !token.access_token)
        throw new HttpError(
          401,
          "GitHub could not complete this sign-in. Start again.",
        );
      const githubHeaders = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token.access_token}`,
        "User-Agent": "SciDA-Research-Portal",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      const [identityResponse, emailResponse] = await Promise.all([
        fetcher("https://api.github.com/user", {
          headers: githubHeaders,
          redirect: "error",
        }),
        fetcher("https://api.github.com/user/emails", {
          headers: githubHeaders,
          redirect: "error",
        }),
      ]);
      if (!identityResponse.ok || !emailResponse.ok)
        throw new HttpError(
          401,
          "GitHub identity and verified-email access are required.",
        );
      const identity = (await identityResponse.json()) as {
          id: number;
          login: string;
          name?: string;
        },
        emails = (await emailResponse.json()) as Array<{
          email: string;
          verified: boolean;
          primary: boolean;
        }>;
      const email = emails.find((item) => item.primary && item.verified)?.email;
      if (
        !Number.isSafeInteger(identity.id) ||
        identity.id <= 0 ||
        typeof identity.login !== "string" ||
        !email
      )
        throw new HttpError(
          403,
          "Confirm your primary GitHub email address before signing in to SciDA.",
        );
      const id = String(identity.id),
        oneTimeCode = randomToken(),
        hash = await digest(oneTimeCode);
      await store.updateAdmin((state) => {
        prune(state.exchanges);
        prune(state.sessions);
        if (!state.profiles[id])
          state.profiles[id] = {
            githubLogin: identity.login,
            email,
            profile: {
              fullName: (identity.name || identity.login).slice(0, 120),
              affiliation: "",
              researchRole: "",
              scholarUrl: "",
              website: "",
              fields: [],
              expertiseTopics: [],
              expertiseStatement: "",
              evidence: "",
            },
          };
        state.profiles[id].githubLogin = identity.login;
        state.profiles[id].email = email;
        state.access[id] ??= {
          role: "Reader",
          approvedTopics: [],
          assignedTopics: [],
        };
        state.exchanges[hash] = {
          userId: id,
          challenge: attempt.challenge,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        };
      });
      // The GitHub user token is never stored, returned, or used for repository writes.
      params.set("code", oneTimeCode);
    } catch (error) {
      params.set(
        "error",
        error instanceof HttpError
          ? error.message
          : "GitHub sign-in is temporarily unavailable. Please try again.",
      );
    }
    destination.hash = "/auth/callback?" + params.toString();
    return new Response(null, {
      status: 302,
      headers: {
        Location: destination.href,
        "Set-Cookie": cookie("", env, true),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  async function exchange(input: unknown) {
    if (
      !object(input) ||
      typeof input.code !== "string" ||
      !opaque.test(input.code) ||
      typeof input.verifier !== "string" ||
      !verifierPattern.test(input.verifier)
    )
      throw new HttpError(
        400,
        "A valid sign-in code and verifier are required.",
      );
    const codeHash = await digest(input.code),
      challenge = await digest(input.verifier),
      token = randomToken(),
      tokenHash = await digest(token),
      expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    await store.updateAdmin((state) => {
      const record = state.exchanges[codeHash];
      if (
        !record ||
        record.challenge !== challenge ||
        !Number.isFinite(Date.parse(record.expiresAt)) ||
        Date.parse(record.expiresAt) <= Date.now()
      )
        throw new HttpError(
          401,
          "The sign-in code expired or was already used. Start again.",
        );
      delete state.exchanges[codeHash];
      prune(state.sessions);
      state.sessions[tokenHash] = {
        userId: record.userId,
        createdAt: new Date().toISOString(),
        expiresAt,
      };
    });
    return { token, expiresAt };
  }
  function bearer(request: Request): string | null {
    const value = request.headers.get("Authorization");
    if (!value) return null;
    if (!value.startsWith("Bearer ") || !opaque.test(value.slice(7)))
      throw new HttpError(401, "Your session is invalid. Sign in again.");
    return value.slice(7);
  }
  async function authenticate(request: Request): Promise<string | null> {
    const token = bearer(request);
    if (!token) return null;
    const state = await store.readAdmin(),
      session = state.sessions[await digest(token)];
    if (
      !session ||
      !Number.isFinite(Date.parse(session.expiresAt)) ||
      Date.parse(session.expiresAt) <= Date.now() ||
      !state.profiles[session.userId]
    )
      throw new HttpError(
        401,
        "Your session expired or was revoked. Sign in again.",
      );
    return session.userId;
  }
  async function logout(request: Request) {
    const token = bearer(request);
    if (!token) return;
    const hash = await digest(token);
    await store.updateAdmin((state) => {
      delete state.sessions[hash];
    });
  }
  return { start, callback, exchange, authenticate, logout };
}
