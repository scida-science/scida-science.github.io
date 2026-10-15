// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import DiscoveryEditor from "./DiscoveryEditor";
import DiscoveryPage from "../pages/DiscoveryPage";
import type { usePortal } from "../state/PortalContext";
import type { ActionResult, Discovery, Role, StatusDecision } from "../types";
import { discoveries } from "../../test/fixtures/discoveries";
import { emptyPortalState } from "../services/repository";

let portal: Pick<ReturnType<typeof usePortal>, "state" | "user" | "configured" | "loading" | "error" |
  "updateDiscovery" | "requestCode" | "downloadMaterial" | "downloadPackageFile" | "setFollowing" | "addComment" | "loadFigure">;
vi.mock("../state/PortalContext", () => ({ usePortal: () => portal }));
const archivedDecision: StatusDecision = {
  from: "Awaiting Validation", to: "Withdrawn", reason: "The author withdrew the current interpretation.",
  decidedAt: "2026-10-16T12:00:00Z", decidedBy: "100", decidedByName: "Test Administrator", version: "v1",
};
const restoration: StatusDecision = {
  from: "Withdrawn", to: "Awaiting Validation", reason: "Updated evidence is ready for further expert review.",
  decidedAt: "2026-10-17T12:00:00Z", decidedBy: "100", decidedByName: "Test Administrator", version: "v2",
};
function brief(changes: Partial<Discovery> = {}): Discovery {
  return { ...structuredClone(discoveries[0]), version: "v1", revision: "current-revision",
    sections: [{ id: "question", title: "Scientific question", body: "A test-only research brief." }],
    ...changes };
}
beforeEach(() => {
  const success = () => vi.fn().mockResolvedValue({ ok: true, message: "Saved." });
  portal = {
    state: emptyPortalState(), configured: true, loading: false, error: null,
    user: { id: "100", fullName: "Test Administrator", email: "test@example.invalid", affiliation: "", researchRole: "",
      scholarUrl: "", website: "", fields: [], expertiseTopics: [], expertiseStatement: "", evidence: "",
      role: "Admin", approvedTopics: [], assignedTopics: [] },
    updateDiscovery: success(), requestCode: success(), downloadMaterial: success(), downloadPackageFile: success(),
    setFollowing: success(), addComment: success(), loadFigure: vi.fn(),
  };
});
afterEach(cleanup);
function editor(discovery = brief()) {
  const onClose = vi.fn();
  const view = render(<DiscoveryEditor discovery={discovery} onClose={onClose} />);
  return { ...view, onClose };
}
function page(discovery: Discovery) {
  portal.state.discoveries = [discovery];
  return render(<MemoryRouter initialEntries={[`/discoveries/${discovery.id}`]}>
    <Routes><Route path="/discoveries/:id" element={<DiscoveryPage />} /></Routes>
  </MemoryRouter>);
}

describe("Administrative status changes", () => {
  it("requires a meaningful public reason before archiving", async () => {
    const { container } = editor();
    const interaction = userEvent.setup();
    await interaction.selectOptions(screen.getByLabelText("Status"), "Withdrawn");
    const reason = screen.getByLabelText("Reason for status change", { exact: false });
    expect(reason.getAttribute("required")).not.toBeNull();
    expect(reason.getAttribute("maxlength")).toBe("2000");
    fireEvent.change(reason, { target: { value: "  short  " } });
    fireEvent.submit(container.querySelector("form")!);
    expect(screen.getByRole("alert").textContent).toContain("between 10 and 2,000");
    expect(portal.updateDiscovery).not.toHaveBeenCalled();
    expect(screen.getByText(/Visible to all readers/)).toBeTruthy();
    expect(screen.getByRole("group", { name: "Archive outcomes" })).toBeTruthy();
  });

  it.each(["Not supported", "Refuted", "Withdrawn"] as const)("submits %s with a reason and leaves history to the server", async (status) => {
    const discovery = brief({ statusHistory: [archivedDecision, restoration] });
    const originalHistory = structuredClone(discovery.statusHistory);
    const { onClose } = editor(discovery);
    const interaction = userEvent.setup();
    await interaction.selectOptions(screen.getByLabelText("Status"), status);
    fireEvent.change(screen.getByLabelText("Reason for status change", { exact: false }), {
      target: { value: "  The review identified a specific unresolved evidence problem.  " },
    });
    await interaction.click(screen.getByRole("button", { name: "Save discovery" }));
    const sent = vi.mocked(portal.updateDiscovery).mock.calls[0][0];
    expect(sent).toMatchObject({ id: discovery.id, revision: "current-revision", status,
      statusChangeReason: "The review identified a specific unresolved evidence problem." });
    expect(sent).not.toHaveProperty("statusHistory");
    expect(discovery.statusHistory).toEqual(originalHistory);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("requires a reason to restore an archived investigation to an active stage", async () => {
    editor(brief({ status: "Withdrawn", statusHistory: [archivedDecision] }));
    const interaction = userEvent.setup();
    await interaction.selectOptions(screen.getByLabelText("Status"), "Awaiting Validation");
    fireEvent.change(screen.getByLabelText("Reason for status change", { exact: false }), {
      target: { value: restoration.reason },
    });
    await interaction.click(screen.getByRole("button", { name: "Save discovery" }));
    expect(portal.updateDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      status: "Awaiting Validation", statusChangeReason: restoration.reason,
    }));
    expect(vi.mocked(portal.updateDiscovery).mock.calls[0][0]).not.toHaveProperty("statusHistory");
  });

  it("saves content-only edits without submitting a status reason or history", async () => {
    editor(brief({ statusHistory: [archivedDecision, restoration] }));
    const interaction = userEvent.setup();
    await interaction.selectOptions(screen.getByLabelText("Status"), "Refuted");
    fireEvent.change(screen.getByLabelText("Reason for status change", { exact: false }), { target: { value: "A draft reason that should not be submitted." } });
    await interaction.selectOptions(screen.getByLabelText("Status"), "Awaiting Validation");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Revised test title" } });
    expect(screen.queryByLabelText("Reason for status change", { exact: false })).toBeNull();
    await interaction.click(screen.getByRole("button", { name: "Save discovery" }));
    const sent = vi.mocked(portal.updateDiscovery).mock.calls[0][0];
    expect(sent.title).toBe("Revised test title");
    expect(sent).not.toHaveProperty("statusChangeReason");
    expect(sent).not.toHaveProperty("statusHistory");
  });

  it("preserves drafts after rejected and unexpected failures and prevents duplicate pending submissions", async () => {
    let resolve!: (value: ActionResult) => void;
    vi.mocked(portal.updateDiscovery).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { container, onClose } = editor();
    const interaction = userEvent.setup();
    await interaction.selectOptions(screen.getByLabelText("Status"), "Withdrawn");
    const reason = screen.getByLabelText("Reason for status change", { exact: false }) as HTMLTextAreaElement;
    fireEvent.change(reason, { target: { value: archivedDecision.reason } });
    await interaction.click(screen.getByRole("button", { name: "Save discovery" }));
    expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(container.querySelector("form")!);
    expect(portal.updateDiscovery).toHaveBeenCalledOnce();
    await act(async () => { resolve({ ok: false, message: "The revision changed. Refresh before editing again." }); });
    expect(screen.getByRole("alert").textContent).toContain("revision changed");
    expect(reason.value).toBe(archivedDecision.reason);
    expect(onClose).not.toHaveBeenCalled();
    vi.mocked(portal.updateDiscovery).mockRejectedValueOnce(new Error("Network failed"));
    await interaction.click(screen.getByRole("button", { name: "Save discovery" }));
    expect(screen.getByRole("alert").textContent).toContain("could not be saved");
    expect(reason.value).toBe(archivedDecision.reason);
    expect((screen.getByRole("button", { name: "Save discovery" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Archive records and public history", () => {
  it("shows the archived outcome and explanation while preserving the brief, materials and discussion", async () => {
    portal.user = null;
    const discovery = brief({ status: "Withdrawn", statusHistory: [archivedDecision],
      materials: { ...brief().materials, paper: "https://api.example.test/paper" } });
    portal.state.comments = [{ id: "real-record-fixture", discoveryId: discovery.id, authorId: "200", authorName: "Test Reviewer",
      parentId: null, version: "v1", reference: "Section 1", body: "A retained discussion contribution.", createdAt: "2026-10-15T10:00:00Z" }];
    page(discovery);
    const banner = screen.getByRole("region", { name: "Withdrawn" });
    expect(within(banner).getByText(archivedDecision.reason)).toBeTruthy();
    expect(within(banner).getByText(/16 Oct 2026/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Archive" }).getAttribute("href")).toBe("/archive");
    expect(screen.getByText("A test-only research brief.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open full paper" })).toBeTruthy();
    expect(await screen.findByText("A retained discussion contribution.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit discovery" })).toBeNull();
  });

  it("keeps earlier archive decisions visible after restoration, newest first", () => {
    const history = [archivedDecision, restoration];
    const discovery = brief({ version: "v2", statusHistory: history });
    page(discovery);
    expect(screen.queryByText("Archived investigation")).toBeNull();
    const decisions = within(screen.getByRole("region", { name: "Status history" })).getAllByRole("listitem");
    expect(decisions).toHaveLength(2);
    expect(within(decisions[0]).getByRole("heading").textContent).toBe("Withdrawn → Awaiting Validation");
    expect(within(decisions[0]).getByText(restoration.reason)).toBeTruthy();
    expect(within(decisions[0]).getByText(/Test Administrator/).textContent).toContain("v2");
    expect(within(decisions[1]).getByText(archivedDecision.reason)).toBeTruthy();
    expect(discovery.statusHistory).toEqual([archivedDecision, restoration]);
  });

  it.each(["Reader", "Reviewer", "Senior Reviewer"] as Role[])("never exposes the editor to %s", async (role) => {
    portal.user!.role = role;
    const view = page(brief({ status: "Withdrawn", statusHistory: [archivedDecision] }));
    expect(screen.queryByRole("button", { name: "Edit discovery" })).toBeNull();
    view.unmount();
    editor();
    await waitFor(() => expect(screen.queryByLabelText("Status")).toBeNull());
    expect(portal.updateDiscovery).not.toHaveBeenCalled();
  });
});
