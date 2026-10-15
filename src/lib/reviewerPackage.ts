import type { ReviewerPackage, ReviewerPackageFile } from "../types";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const filename = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value) && !value.includes("..");

/** Never attach the session to a URL supplied by a package manifest. */
export function parseReviewerPackage(value: unknown, baseUrl: string, materialPath: string): ReviewerPackage {
  if (!object(value) || !filename(value.filename) || !hash(value.sha256) ||
      !Number.isSafeInteger(value.size) || (value.size as number) < 1 ||
      !Array.isArray(value.files) || value.files.length < 4 || value.files.length > 512)
    throw new Error("The reviewer package index is invalid.");
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const file of value.files) {
    if (!object(file) || typeof file.id !== "string" || !/^[a-z0-9-]{1,64}$/.test(file.id) ||
        !filename(file.filename) || !hash(file.sha256) || !Number.isSafeInteger(file.size) ||
        (file.size as number) < 1 || (file.size as number) > 100 * 1024 * 1024 ||
        ids.has(file.id) || names.has(file.filename))
      throw new Error("The reviewer package file index is invalid.");
    const expected = `${baseUrl}${materialPath}/files/${encodeURIComponent(file.id)}`;
    if (file.url !== expected) throw new Error("The reviewer package contains an unexpected download URL.");
    ids.add(file.id); names.add(file.filename);
  }
  return value as unknown as ReviewerPackage;
}

export interface PackageDirectory {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    getFile(): Promise<Blob>;
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
  }>;
}

export async function verifyPackageFile(blob: Blob, file: ReviewerPackageFile): Promise<void> {
  if (blob.size !== file.size) throw new Error(`Incomplete package file: ${file.filename}.`);
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const actual = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
  if (actual !== file.sha256) throw new Error(`Checksum mismatch: ${file.filename}.`);
}

/** Resume identical files, and never overwrite an unrelated existing file. */
export async function existingPackageFile(directory: PackageDirectory, file: ReviewerPackageFile): Promise<boolean> {
  let handle;
  try { handle = await directory.getFileHandle(file.filename); }
  catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return false;
    throw error;
  }
  await verifyPackageFile(await handle.getFile(), file);
  return true;
}
