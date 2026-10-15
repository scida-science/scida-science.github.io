import { createHash, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api";
import { existingPackageFile, parseReviewerPackage, verifyPackageFile } from "./reviewerPackage";

const base = "https://api.example.org";
const path = "/v1/discoveries/AST-001/materials/repository";
const sha = createHash("sha256").update("content").digest("hex");
const file = (id: string) => ({ id, filename: `${id}.bin`, size: 7, sha256: sha, url: `${base}${path}/files/${id}` });
const manifest = () => ({ filename: "analysis.zip", size: 7, sha256: sha,
  files: [file("readme"), file("assemble"), file("archive-index"), file("part001")] });
afterEach(() => vi.unstubAllGlobals());

describe("reviewer package transport", () => {
  it("accepts only expected authorized file URLs and unique safe filenames", () => {
    expect(parseReviewerPackage(manifest(), base, path).files).toHaveLength(4);
    for (const change of [
      { url: "https://outside.example/file" }, { url: `${base}/unrelated` },
      { filename: "../private.txt" }, { filename: "part001.bin" }, { size: 101 * 1024 * 1024 },
    ]) {
      const value = manifest(); Object.assign(value.files[0], change);
      expect(() => parseReviewerPackage(value, base, path)).toThrow();
    }
  });
  it("loads an authorized package index without fetching its files", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ package: manifest() }), {
      headers: { "Content-Type": "application/json" },
    }));
    const client = createApiClient(base, { fetch: fetcher, storage: null });
    expect((await client.download(path)).package?.filename).toBe("analysis.zip");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("stops an oversized response before saving it", async () => {
    const client = createApiClient(base, { storage: null, fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("too much content")) });
    await expect(client.download(`${path}/files/part001`, { maxBytes: 7 })).rejects.toThrow("recorded size");
  });
  it("verifies bytes and refuses to overwrite a different existing file", async () => {
    vi.stubGlobal("crypto", webcrypto);
    await expect(verifyPackageFile(new Blob(["content"]), file("part001"))).resolves.toBeUndefined();
    await expect(verifyPackageFile(new Blob(["changed"]), file("part001"))).rejects.toThrow("Checksum");
    const getFile = vi.fn().mockResolvedValue(new Blob(["changed"]));
    const createWritable = vi.fn();
    await expect(existingPackageFile({ getFileHandle: vi.fn().mockResolvedValue({ getFile, createWritable }) }, file("part001")))
      .rejects.toThrow("Checksum");
    expect(createWritable).not.toHaveBeenCalled();
  });
});
