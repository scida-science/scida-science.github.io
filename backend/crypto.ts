import { createPrivateKey, sign } from "node:crypto";

export const randomToken = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
export const digest = async (value: string) =>
  Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).toString("base64url");
export async function seal(value: unknown, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Buffer.concat([Buffer.from(iv), Buffer.from(data)]).toString(
    "base64url",
  );
}
export async function unseal(value: string, secret: string): Promise<unknown> {
  const bytes = Buffer.from(value, "base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.subarray(0, 12) },
    key,
    bytes.subarray(12),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}
export function appJwt(appId: string, pem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const data = [
    { alg: "RS256", typ: "JWT" },
    { iat: now - 60, exp: now + 540, iss: appId },
  ]
    .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
    .join(".");
  // GitHub's downloaded PKCS#1 and converted PKCS#8 PEM formats are supported.
  return (
    data +
    "." +
    sign(
      "RSA-SHA256",
      Buffer.from(data),
      createPrivateKey(pem.replace(/\\n/g, "\n")),
    ).toString("base64url")
  );
}
