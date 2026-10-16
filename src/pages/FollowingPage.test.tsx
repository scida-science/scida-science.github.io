// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import HomePage from "./HomePage";
import FollowDiscovery from "../components/FollowDiscovery";
import { discoveries } from "../../test/fixtures/discoveries";
import type { Profile } from "../types";
import type { usePortal } from "../state/PortalContext";

let portal: ReturnType<typeof usePortal>;
vi.mock("../state/PortalContext", () => ({ usePortal: () => portal }));
const reader: Profile = {
  id: "following-test", fullName: "Researcher", email: "test@example.invalid",
  affiliation: "", researchRole: "", scholarUrl: "", website: "", fields: [],
  expertiseTopics: [], expertiseStatement: "", evidence: "", role: "Reader",
  approvedTopics: [], assignedTopics: [], followedDiscoveryIds: [],
};
beforeEach(() => {
  const success = () => vi.fn().mockResolvedValue({ ok: true, message: "Saved." });
  portal = {
    state: { discoveries: structuredClone(discoveries), profiles: [], comments: [], codeRequests: [], applications: [], invitations: [] },
    user: structuredClone(reader), configured: true, loading: false, error: null,
    signInWithGitHub: success(), signOut: success(), refresh: success(), setFollowing: success(), markNotificationsRead: success(), saveProfile: success(),
    applyForReview: success(), reviewApplication: success(), createInvitation: success(), previewInvitation: success(),
    confirmInvitation: success(), addComment: success(), requestCode: success(), updateDiscovery: success(), setAccess: success(),
    downloadMaterial: success(), downloadPackageFile: success(), loadFigure: vi.fn(),
  };
});
afterEach(cleanup);
const page = (followingOnly = true) => <MemoryRouter><HomePage followingOnly={followingOnly} /></MemoryRouter>;

describe("Following research", () => {
  it("shows only followed discoveries in newest-update order and retains field filtering", async () => {
    portal.user!.followedDiscoveryIds = ["AI-001", "AST-001"];
    const expected = portal.state.discoveries.filter((d) => portal.user!.followedDiscoveryIds!.includes(d.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    render(page());
    const cards = within(screen.getByRole("tabpanel")).getAllByRole("article");
    expect(cards).toHaveLength(2);
    cards.forEach((card, index) => expect(within(card).getByRole("heading", { name: expected[index].title })).toBeTruthy());
    await userEvent.setup().click(screen.getByRole("tab", { name: "Astronomy" }));
    expect(within(screen.getByRole("tabpanel")).getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: discoveries.find((d) => d.id === "AI-001")!.title })).toBeNull();
  });

  it("offers Explore for an empty saved list and requires sign-in for visitors", () => {
    const view = render(page());
    expect(screen.getByRole("heading", { name: "No followed discoveries yet" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Explore discoveries" }).getAttribute("href")).toBe("/");
    portal.user = null;
    view.rerender(page());
    expect(screen.getByRole("link", { name: "Sign in with GitHub" }).getAttribute("href")).toBe("/login");
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("keeps follow buttons outside discovery links and waits for shared state before confirming", async () => {
    const view = render(page(false));
    const discovery = discoveries[0];
    const button = screen.getByRole("button", { name: `Follow ${discovery.title}` });
    expect(button.closest("a")).toBeNull();
    await userEvent.setup().click(button);
    expect(portal.setFollowing).toHaveBeenCalledWith(discovery.id, true);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    portal.user!.followedDiscoveryIds = [discovery.id];
    view.rerender(page(false));
    expect(screen.getByRole("button", { name: `Unfollow ${discovery.title}` }).getAttribute("aria-pressed")).toBe("true");
  });

  it("does not remove a followed discovery when saving fails", async () => {
    const discovery = discoveries[0];
    portal.user!.followedDiscoveryIds = [discovery.id];
    vi.mocked(portal.setFollowing).mockResolvedValue({ ok: false, message: "GitHub storage is unavailable." });
    render(page());
    await userEvent.setup().click(screen.getByRole("button", { name: `Unfollow ${discovery.title}` }));
    expect(portal.setFollowing).toHaveBeenCalledWith(discovery.id, false);
    expect(screen.getByRole("alert").textContent).toContain("GitHub storage is unavailable.");
    expect(screen.getByRole("heading", { name: discovery.title })).toBeTruthy();
  });

  it("links visitors to sign-in without pretending to save a follow", () => {
    portal.user = null;
    render(<MemoryRouter><FollowDiscovery discovery={discoveries[0]} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Sign in to follow" }).getAttribute("href")).toBe("/login");
    expect(portal.setFollowing).not.toHaveBeenCalled();
  });
});
