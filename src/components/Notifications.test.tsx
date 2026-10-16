// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import NotificationBell from "./NotificationBell";
import NotificationsPage from "../pages/NotificationsPage";
import NotificationList from "./NotificationList";
import type { usePortal } from "../state/PortalContext";
import type { ActionResult, PortalNotification } from "../types";
import { emptyPortalState } from "../services/repository";
import App from "../App";
import { discoveries } from "../../test/fixtures/discoveries";

let portal: Pick<ReturnType<typeof usePortal>, "state" | "user" | "markNotificationsRead" | "refresh" | "loading" | "error" | "configured">;
vi.mock("../state/PortalContext", () => ({ usePortal: () => portal }));
const notification = (changes: Partial<PortalNotification> = {}): PortalNotification => ({
  id: "notification-1", kind: "reply", discoveryId: "AST-001", discoveryTitle: "An investigation of variable stars",
  createdAt: "2026-10-16T12:00:00Z", read: false, commentId: "comment-7", version: "v0.1", actorName: "Researcher One", ...changes,
});
beforeEach(() => {
  portal = {
    state: { ...emptyPortalState(), notifications: [notification()] }, loading: false, error: null, configured: true,
    user: { id: "reader", fullName: "Reader", email: "test@example.invalid", affiliation: "", researchRole: "", scholarUrl: "", website: "", fields: [], expertiseTopics: [], expertiseStatement: "", evidence: "", role: "Reader", approvedTopics: [], assignedTopics: [] },
    markNotificationsRead: vi.fn().mockResolvedValue({ ok: true, message: "Notifications marked read." }),
    refresh: vi.fn().mockResolvedValue(undefined),
  };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function CurrentRoute() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}{location.search}</output>;
}
const bellView = () => <MemoryRouter><div className="account-controls"><NotificationBell /></div><button>Outside control</button><CurrentRoute /></MemoryRouter>;

describe("Notification bell", () => {
  it("hides private notifications from signed-out visitors", () => {
    portal.user = null;
    render(bellView());
    expect(screen.queryByRole("button", { name: /Notifications/ })).toBeNull();
    expect(screen.queryByText("An investigation of variable stars")).toBeNull();
  });

  it("announces the unread count, caps the badge, and shows the five most recent items", async () => {
    portal.state.notifications = Array.from({ length: 105 }, (_, index) => notification({ id: `n-${index}`, discoveryTitle: `Investigation ${index}` }));
    render(bellView());
    const interaction = userEvent.setup();
    await interaction.click(screen.getByRole("button", { name: "Notifications, 105 unread" }));
    expect(screen.getByText("99+")).toBeTruthy();
    const panel = screen.getByRole("region", { name: "Notifications" });
    expect(within(panel).getAllByRole("listitem")).toHaveLength(5);
    expect(within(panel).getByRole("link", { name: "View all notifications" }).getAttribute("href")).toBe("/notifications");
  });

  it("supports keyboard opening, item navigation, escape, and outside dismissal", async () => {
    render(bellView());
    const interaction = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Notifications, 1 unread" });
    trigger.focus();
    await interaction.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Mark all read" }));
    await interaction.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("link", { name: /replied to your discussion/ }));
    await interaction.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "View all notifications" }));
    await interaction.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
    await interaction.click(trigger);
    await interaction.click(screen.getByRole("button", { name: "Outside control" }));
    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
    await interaction.click(trigger);
    await interaction.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Mark all read" }));
  });

  it("keeps keyboard focus stable when refreshed notifications arrive", async () => {
    const { rerender } = render(bellView());
    const interaction = userEvent.setup();
    await interaction.click(screen.getByRole("button", { name: /Notifications/ }));
    const viewAll = screen.getByRole("link", { name: "View all notifications" });
    viewAll.focus();
    portal = { ...portal, state: { ...portal.state, notifications: [notification({ read: true }), notification({ id: "new" })] } };
    rerender(bellView());
    expect(document.activeElement).toBe(viewAll);
  });

  it("navigates immediately to the comment and version, and exposes failed read persistence", async () => {
    let finish!: (result: ActionResult) => void;
    vi.mocked(portal.markNotificationsRead).mockImplementation(() => new Promise<ActionResult>((resolve) => { finish = resolve; }));
    render(bellView());
    const interaction = userEvent.setup();
    await interaction.click(screen.getByRole("button", { name: /Notifications/ }));
    await interaction.click(screen.getByRole("link", { name: /replied to your discussion/ }));
    expect(screen.getByLabelText("Current route").textContent).toBe("/discoveries/AST-001?comment=comment-7&version=v0.1");
    expect(portal.markNotificationsRead).toHaveBeenCalledWith(["notification-1"]);
    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
    await act(async () => finish({ ok: false, message: "Read status could not be saved." }));
    expect(screen.getByRole("alert").textContent).toContain("Read status could not be saved.");
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy();
    await interaction.click(screen.getByRole("button", { name: "Dismiss notification error" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks every unread item, including items outside the preview, without assuming success", async () => {
    portal.state.notifications = Array.from({ length: 7 }, (_, index) => notification({ id: `n-${index}`, read: index === 6 }));
    vi.mocked(portal.markNotificationsRead).mockRejectedValue(new Error("Connection lost"));
    render(bellView());
    const interaction = userEvent.setup();
    await interaction.click(screen.getByRole("button", { name: /Notifications/ }));
    await interaction.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(portal.markNotificationsRead).toHaveBeenCalledWith(["n-0", "n-1", "n-2", "n-3", "n-4", "n-5"]);
    expect(screen.getByRole("alert").textContent).toContain("Could not save notification read status");
    expect(screen.getByRole("button", { name: "Notifications, 6 unread" })).toBeTruthy();
  });

  it("renders loading, empty, and refresh failure states without claiming success", async () => {
    portal.loading = true;
    portal.state.notifications = [];
    const { rerender } = render(bellView());
    const interaction = userEvent.setup();
    await interaction.click(screen.getByRole("button", { name: "Notifications" }));
    expect(within(screen.getByRole("region", { name: "Notifications" })).getByRole("status").textContent).toBe("Loading notifications…");
    portal = { ...portal, loading: false };
    rerender(bellView());
    expect(screen.getByText(/You’re all caught up/)).toBeTruthy();
    portal = { ...portal, error: "Connection lost" };
    rerender(bellView());
    expect(screen.getByRole("alert").textContent).toContain("Notifications could not be refreshed");
    await interaction.click(screen.getByRole("button", { name: "Try again" }));
    expect(portal.refresh).toHaveBeenCalledOnce();
  });
});

describe("Notifications page and entries", () => {
  it("opens an older contribution from the inbox after the application's route focus runs", async () => {
    vi.stubGlobal("scrollTo", vi.fn());
    HTMLElement.prototype.scrollIntoView = vi.fn();
    portal.state.discoveries = [discoveries[0]];
    portal.state.notifications = [notification({ discoveryId: discoveries[0].id, commentId: "old-comment", version: "v0.1" })];
    portal.state.comments = [{ id: "old-comment", discoveryId: discoveries[0].id, authorId: "author", authorName: "Earlier reviewer", parentId: null, version: "v0.1", reference: "", body: "An older manuscript question.", createdAt: "2026-10-15T12:00:00Z" }];
    render(<MemoryRouter initialEntries={["/notifications"]}><App /></MemoryRouter>);
    const interaction = userEvent.setup();
    expect(document.activeElement).toBe(document.getElementById("main-content"));
    await interaction.click(screen.getByRole("link", { name: /replied to your discussion/ }));
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById("comment-old-comment")));
    expect((screen.getByRole("combobox", { name: /Show discussions for/ }) as HTMLSelectElement).value).toBe("v0.1");
    expect(portal.markNotificationsRead).toHaveBeenCalledWith(["notification-1"]);
  });

  it("requires sign-in and never displays a previous account's cached inbox", () => {
    portal.user = null;
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Sign in with GitHub" })).toBeTruthy();
    expect(screen.queryByText("An investigation of variable stars")).toBeNull();
  });

  it("shows the complete inbox with update reasons and acknowledges only unread items", async () => {
    portal.state.notifications = [notification(), notification({ id: "n2", kind: "discovery-update", commentId: undefined, actorName: undefined, status: "Refuted", read: true }), notification({ id: "n3", kind: "discussion" })];
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    const interaction = userEvent.setup();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Refuted")).toBeTruthy();
    await interaction.click(screen.getByRole("link", { name: /A discovery you follow was updated/ }));
    expect(portal.markNotificationsRead).not.toHaveBeenCalled();
    await interaction.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(portal.markNotificationsRead).toHaveBeenCalledWith(["notification-1", "n3"]);
  });

  it("renders notification text safely and encodes identifiers in links", () => {
    const { container } = render(<MemoryRouter><NotificationList notifications={[notification({ discoveryId: "with/slash", commentId: "reply&x=1", discoveryTitle: "<img src=x onerror=alert(1)>" })]} onRead={vi.fn()} /></MemoryRouter>);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/discoveries/with%2Fslash?comment=reply%26x%3D1&version=v0.1");
  });
});
