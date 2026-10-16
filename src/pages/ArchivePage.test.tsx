// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HashRouter, MemoryRouter } from "react-router-dom";
import App from "../App";
import HomePage from "./HomePage";
import { discoveries } from "../../test/fixtures/discoveries";
import { archiveStages } from "../data/discoveryStages";
import type { Discovery, Profile } from "../types";
import type { usePortal } from "../state/PortalContext";

let portal: ReturnType<typeof usePortal>;
let archived: Discovery[];
vi.mock("../state/PortalContext", () => ({ usePortal: () => portal }));
const reader: Profile = {
  id: "archive-test", fullName: "Researcher", email: "test@example.invalid",
  affiliation: "", researchRole: "", scholarUrl: "", website: "", fields: ["Astronomy"],
  expertiseTopics: ["exoplanets"], expertiseStatement: "", evidence: "", role: "Reader",
  approvedTopics: [], assignedTopics: [], followedDiscoveryIds: [],
};
beforeEach(() => {
  const success = () => vi.fn().mockResolvedValue({ ok: true, message: "Saved." });
  archived = archiveStages.map((status, index) => ({
    ...structuredClone(discoveries.find((d) => d.id === (index === 0 ? "AI-001" : "AST-001"))!),
    id: `archived-fixture-${index}`,
    title: `Test investigation: ${status}`,
    status,
    updatedAt: `2026-10-${15 - index}T12:00:00Z`,
    reviewNote: "Validation record: superseded positive review.",
    statusHistory: [{
      from: "Awaiting Validation", to: status, reason: `Recorded reason for ${status}: controlled test outcome.`,
      decidedAt: `2026-10-${15 - index}T12:00:00Z`, decidedBy: "owner-test",
      decidedByName: "Test owner", version: "v0.1",
    }],
  }));
  portal = {
    state: { discoveries: [...structuredClone(discoveries), ...archived], profiles: [], comments: [], codeRequests: [], applications: [], invitations: [] },
    user: null, configured: true, loading: false, error: null,
    signInWithGitHub: success(), signOut: success(), refresh: success(), setFollowing: success(), markNotificationsRead: success(), saveProfile: success(),
    applyForReview: success(), reviewApplication: success(), createInvitation: success(), previewInvitation: success(),
    confirmInvitation: success(), addComment: success(), requestCode: success(), updateDiscovery: success(), setAccess: success(),
    downloadMaterial: success(), downloadPackageFile: success(), loadFigure: vi.fn(),
  };
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });
const page = (mode: "archive" | "explore" | "following" = "archive") => (
  <MemoryRouter><HomePage archiveOnly={mode === "archive"} followingOnly={mode === "following"} /></MemoryRouter>
);
const results = () => within(screen.getByRole("tabpanel"));

describe("Archive research feed", () => {
  it("opens the public Archive hash route directly with permanent discovery links and recorded outcomes", () => {
    window.history.replaceState(null, "", "/#/archive");
    render(<HashRouter><App /></HashRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "Archive" })).toBeTruthy();
    expect(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("link", { name: "Archive" }).getAttribute("aria-current")).toBe("page");
    expect(document.title).toBe("Archive · SciDA");
    const cards = results().getAllByRole("article");
    expect(cards).toHaveLength(3);
    cards.forEach((card, index) => {
      const discovery = archived[index];
      const heading = within(card).getByRole("heading", { name: discovery.title });
      expect(heading.closest("a")?.getAttribute("href")).toBe(`#/discoveries/${discovery.id}`);
      expect(within(card).getByText(`Archived · ${discovery.status}`)).toBeTruthy();
      expect(card.textContent).toContain(discovery.statusHistory![0].reason);
      expect(card.textContent).not.toContain("superseded positive review");
    });
    expect(results().queryByRole("heading", { name: discoveries[0].title })).toBeNull();
    expect(screen.queryByRole("tab", { name: "For you" })).toBeNull();
  });

  it("combines field, outcome, and decision-text search filters and supports keyboard field selection", async () => {
    const user = userEvent.setup();
    render(page());
    const allFields = screen.getByRole("tab", { name: "All fields" });
    allFields.focus();
    await user.keyboard("{End}");
    const lastField = screen.getAllByRole("tab").at(-1)!;
    expect(document.activeElement).toBe(lastField);
    expect(lastField.getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("tab", { name: "Astronomy" }));
    expect(results().getAllByRole("article")).toHaveLength(2);
    const outcome = screen.getByRole("combobox", { name: "Archive outcome" });
    expect(within(outcome).getAllByRole("option").map((option) => option.textContent)).toEqual(["All outcomes", ...archiveStages]);
    await user.selectOptions(outcome, "Refuted");
    expect(results().getAllByRole("article")).toHaveLength(1);
    expect(results().getByRole("heading", { name: archived[1].title })).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Search discoveries" }), "controlled test outcome");
    expect(results().getAllByRole("article")).toHaveLength(1);
    await user.selectOptions(outcome, "Not supported");
    expect(screen.getByRole("heading", { name: "No discoveries match" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(results().getAllByRole("article")).toHaveLength(3);
    expect(allFields.getAttribute("aria-selected")).toBe("true");
  });

  it("excludes archived outcomes from Explore even when they match a research profile", () => {
    portal.user = structuredClone(reader);
    render(page("explore"));
    expect(screen.getByRole("tab", { name: "For you" }).getAttribute("aria-selected")).toBe("true");
    expect(results().getAllByRole("article")).toHaveLength(discoveries.length);
    archived.forEach((discovery) => expect(results().queryByRole("heading", { name: discovery.title })).toBeNull());
    expect(within(screen.getByRole("combobox", { name: "Discovery status" })).getAllByRole("option").map((option) => option.textContent)).toEqual(["All stages", "Awaiting Validation", "Validated", "Published"]);
  });

  it("retains archived investigations in Following and filters all six statuses", async () => {
    portal.user = { ...structuredClone(reader), followedDiscoveryIds: [discoveries[0].id, ...archived.map((discovery) => discovery.id)] };
    render(page("following"));
    expect(results().getAllByRole("article")).toHaveLength(4);
    const statuses = screen.getByRole("combobox", { name: "Discovery status" });
    expect(within(statuses).getAllByRole("option")).toHaveLength(7);
    await userEvent.setup().selectOptions(statuses, "Refuted");
    expect(results().getAllByRole("article")).toHaveLength(1);
    expect(results().getByText("Archived · Refuted")).toBeTruthy();
    expect(results().getByRole("button", { name: `Unfollow ${archived[1].title}` })).toBeTruthy();
  });

  it("shows an honest empty Archive without inventing archived records", () => {
    portal.state.discoveries = structuredClone(discoveries);
    render(page());
    expect(screen.getByRole("heading", { name: "No archived investigations" })).toBeTruthy();
    expect(results().queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Explore active investigations" }).getAttribute("href")).toBe("/");
  });

  it("resets unavailable outcome filters when navigating from Archive to Explore", async () => {
    render(<MemoryRouter initialEntries={["/archive"]}><App /></MemoryRouter>);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "Archive outcome" }), "Refuted");
    await user.click(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("link", { name: "Explore" }));
    expect(results().getAllByRole("article")).toHaveLength(discoveries.length);
    expect((screen.getByRole("combobox", { name: "Discovery status" }) as HTMLSelectElement).value).toBe("All stages");
    expect(document.title).toBe("Explore · SciDA");
  });

  it("uses the latest decision for the current outcome and moves restored research back to Explore", () => {
    const original = archived[0].statusHistory![0];
    archived[0].statusHistory = [
      original,
      { ...original, from: "Not supported", to: "Awaiting Validation", reason: "Reopened for further review." },
      { ...original, reason: "Latest recorded outcome after a repeat check." },
    ];
    const view = render(page());
    expect(results().getByText(/Latest recorded outcome after a repeat check/)).toBeTruthy();
    expect(results().queryByText(original.reason, { exact: false })).toBeNull();
    archived[0].status = "Awaiting Validation";
    archived[0].statusHistory.push({ ...original, from: "Not supported", to: "Awaiting Validation", reason: "Restored with new evidence." });
    view.rerender(page());
    expect(results().queryByRole("heading", { name: archived[0].title })).toBeNull();
    view.rerender(page("explore"));
    expect(results().getByRole("heading", { name: archived[0].title })).toBeTruthy();
  });
});
