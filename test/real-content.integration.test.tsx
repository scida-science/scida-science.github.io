// @vitest-environment jsdom
// Opt-in only: reads prepared private repositories without copying their research into this project.
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import type { Discovery, Profile, ReviewerPackage } from "../src/types";
import type { usePortal } from "../src/state/PortalContext";

interface PreparedDocument {
  discovery: Discovery;
  visibility: string;
  materials: Record<keyof Discovery["materials"], { path?: string; access: string } | null>;
}
interface PackageManifest {
  filename: string;
  size: number;
  sha256: string;
  files: Array<{ id: string; path: string; size: number; sha256: string }>;
}
const sourceRoot = process.env.SCIDA_DISCOVERY_ROOT;
const prepared = sourceRoot ? readdirSync(sourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    const directory = join(sourceRoot, entry.name);
    try {
      const document = JSON.parse(readFileSync(join(directory, "discovery.json"), "utf8")) as PreparedDocument;
      return document.discovery.illustrative === false ? [{ directory, document }] : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }) : [];

let portal: ReturnType<typeof usePortal>;
vi.mock("../src/state/PortalContext", () => ({ usePortal: () => portal }));
const account: Profile = {
  id: "integration-reader", fullName: "Integration researcher", email: "test@example.invalid",
  affiliation: "", researchRole: "", scholarUrl: "", website: "", fields: ["Astronomy"],
  expertiseTopics: [], expertiseStatement: "", evidence: "", role: "Reader", approvedTopics: [], assignedTopics: [],
};

function publicDiscovery(document: PreparedDocument): Discovery {
  const discovery = structuredClone(document.discovery);
  discovery.restrictedMaterials = [];
  for (const kind of Object.keys(document.materials) as Array<keyof Discovery["materials"]>) {
    const material = document.materials[kind];
    discovery.materials[kind] = material?.access === "public" ? "available" : null;
    if (material && material.access !== "public") discovery.restrictedMaterials.push(kind);
  }
  return discovery;
}
function open(path = "/") {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

describe.skipIf(!sourceRoot)("prepared astronomy content in the website", () => {
  beforeEach(() => {
    const success = () => vi.fn().mockResolvedValue({ ok: true, message: "Saved." });
    portal = {
      state: { discoveries: prepared.map(({ document }) => publicDiscovery(document)), profiles: [], comments: [], codeRequests: [], applications: [], invitations: [] },
      user: null, configured: true, loading: false, error: null,
      signInWithGitHub: success(), signOut: success(), refresh: success(), setFollowing: success(), saveProfile: success(),
      applyForReview: success(), reviewApplication: success(), createInvitation: success(), previewInvitation: success(),
      confirmInvitation: success(), addComment: success(), requestCode: success(), updateDiscovery: success(), setAccess: success(),
      downloadMaterial: success(), downloadPackageFile: success(),
      loadFigure: vi.fn(async (discoveryId, figureId) => {
        const record = prepared.find(({ document }) => document.discovery.id === discoveryId)!;
        const figure = record.document.discovery.figures!.find((item) => item.id === figureId)!;
        const bytes = readFileSync(join(record.directory, figure.path));
        expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        return new Blob([bytes], { type: "image/png" });
      }),
    };
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:prepared-evidence"), revokeObjectURL: vi.fn(),
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows all three public questions, findings, selected headline figures and unchanged stages", async () => {
    expect(prepared).toHaveLength(3);
    const interaction = userEvent.setup();
    open();
    expect(within(screen.getByRole("tabpanel")).getAllByRole("article")).toHaveLength(3);
    for (const { document } of prepared) {
      const discovery = document.discovery;
      expect(document.visibility).toBe("public");
      expect(discovery.status).toBe("Awaiting Validation");
      expect(screen.getByRole("heading", { name: discovery.title })).toBeTruthy();
      expect(screen.getByText(discovery.question!)).toBeTruthy();
      expect(screen.getByText(discovery.summary)).toBeTruthy();
      const headline = discovery.figures!.find((figure) => figure.id === discovery.headlineFigureId)!;
      expect(await screen.findByAltText(headline.alt)).toBeTruthy();
      expect(screen.getByText(headline.caption)).toBeTruthy();
      expect(screen.queryByText(discovery.id)).toBeNull();
      for (const figure of discovery.figures!.filter((item) => item.id !== headline.id))
        expect(screen.queryByAltText(figure.alt)).toBeNull();
    }
    await interaction.click(screen.getByRole("tab", { name: "Artificial Intelligence" }));
    expect(screen.getByText("No discoveries match")).toBeTruthy();
    expect(within(screen.getByRole("tabpanel")).queryByRole("article")).toBeNull();
    await interaction.click(screen.getByRole("tab", { name: "Astronomy" }));
    expect(within(screen.getByRole("tabpanel")).getAllByRole("article")).toHaveLength(3);
  });

  it("preserves each research brief and three evidence figures, with public papers and signed-in code requests", async () => {
    const interaction = userEvent.setup();
    for (const { document } of prepared) {
      const discovery = document.discovery;
      expect(document.materials.paper?.access).toBe("public");
      const view = open(`/discoveries/${discovery.id}`);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(discovery.title);
      for (const section of discovery.sections) {
        expect(screen.getByRole("heading", { name: section.title })).toBeTruthy();
        const rendered = globalThis.document.getElementById(`section-${section.id}`)!;
        for (const paragraph of section.body.split(/\n\s*\n/))
          expect([...rendered.querySelectorAll("p")].some((element) => element.textContent === paragraph)).toBe(true);
      }
      for (const figure of discovery.figures!) {
        expect(await screen.findByAltText(figure.alt)).toBeTruthy();
        expect(screen.getByText(figure.caption)).toBeTruthy();
      }
      expect(screen.getAllByRole("link", { name: /Open full-size figure/ })).toHaveLength(3);
      expect(screen.queryByText(discovery.id)).toBeNull();
      expect(screen.getByRole("link", { name: "Sign in to request code" }).getAttribute("href")).toBe("/login");
      await interaction.click(screen.getByRole("button", { name: "Open full paper" }));
      expect(portal.downloadMaterial).toHaveBeenLastCalledWith(discovery.id, "paper");
      view.unmount();
      portal.user = { ...account };
      const signedIn = open(`/discoveries/${discovery.id}`);
      await interaction.click(screen.getByRole("button", { name: "Request code" }));
      await interaction.type(screen.getByRole("textbox", { name: "Why would you like access?" }), "Review the documented analysis and reproduction instructions.");
      await interaction.click(screen.getByRole("button", { name: "Submit code request" }));
      expect(portal.requestCode).toHaveBeenLastCalledWith(discovery.id, "Review the documented analysis and reproduction instructions.");
      signedIn.unmount();
      portal.user = null;
    }
  });

  it("lists the actual complete package for approved topic reviewers without private storage paths", async () => {
    const interaction = userEvent.setup();
    for (const { directory, document } of prepared) {
      const discovery = document.discovery;
      portal.user = { ...account, role: "Reviewer", approvedTopics: [discovery.topic] };
      portal.state.discoveries.find((item) => item.id === discovery.id)!.materials.repository = "available";
      const manifest = JSON.parse(readFileSync(join(directory, document.materials.repository!.path!), "utf8")) as PackageManifest;
      const bundle: ReviewerPackage = {
        filename: manifest.filename, size: manifest.size, sha256: manifest.sha256,
        files: manifest.files.map((file) => ({ id: file.id, filename: basename(file.path), size: file.size, sha256: file.sha256, url: "private-location-not-rendered" })),
      };
      vi.mocked(portal.downloadMaterial).mockResolvedValue({ ok: true, message: "Ready.", package: bundle });
      const view = open(`/discoveries/${discovery.id}`);
      await interaction.click(screen.getByRole("button", { name: "Open analysis code" }));
      const panel = screen.getByRole("region", { name: "Complete reviewer package" });
      await interaction.click(within(panel).getByText("Individual files"));
      expect(within(panel).getAllByRole("button")).toHaveLength(manifest.files.length);
      expect(manifest.files.some((file) => basename(file.path) === "README.md")).toBe(true);
      expect(manifest.files.some((file) => basename(file.path) === "assemble.py")).toBe(true);
      expect(manifest.files.filter((file) => /^part\d+$/.test(file.id)).reduce((total, file) => total + file.size, 0)).toBe(manifest.size);
      await interaction.click(within(panel).getByRole("button", { name: /^README\.md/ }));
      expect(portal.downloadPackageFile).toHaveBeenLastCalledWith(discovery.id, "repository", expect.objectContaining({ filename: "README.md" }), undefined);
      expect(panel.innerHTML).not.toContain("private-location-not-rendered");
      expect(panel.innerHTML).not.toContain("reviewer/parts/");
      view.unmount();
    }
  });
});
