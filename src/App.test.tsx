// @vitest-environment jsdom
// Fixtures and simulated responses in this file are test-only; the application uses the authenticated research API.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act, cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HashRouter, MemoryRouter } from "react-router-dom";
import App from "./App";
import { discoveries } from "../test/fixtures/discoveries";
import type { Profile, ActionResult } from "./types";
import type { usePortal } from "./state/PortalContext";

let portal: ReturnType<typeof usePortal>;
vi.mock("./state/PortalContext", () => ({ usePortal: () => portal }));

const researcher: Profile = {
  id: "test-reader",
  fullName: "Test Researcher",
  email: "researcher@example.org",
  affiliation: "Research institute",
  researchRole: "Researcher",
  scholarUrl: "",
  website: "",
  fields: [],
  expertiseTopics: [],
  expertiseStatement: "",
  evidence: "Research project with a reproducible implementation.",
  role: "Reader",
  approvedTopics: [],
  assignedTopics: [],
};
function openApp(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
function signedIn(profile: Profile = researcher) {
  portal.user = structuredClone(profile);
  portal.state.profiles = [portal.user];
}

beforeEach(() => {
  const success = () =>
    vi.fn().mockResolvedValue({ ok: true, message: "Saved." });
  portal = {
    state: {
      discoveries: structuredClone(discoveries),
      profiles: [],
      comments: [],
      codeRequests: [],
      applications: [],
      invitations: [],
    },
    user: null,
    configured: true,
    loading: false,
    error: null,
    signInWithGitHub: success(),
    loadFigure: vi.fn().mockResolvedValue(new Blob([], { type: "image/png" })),
    downloadMaterial: success(),
    downloadPackageFile: success(),
    signOut: success(),
    refresh: success(),
    saveProfile: success(),
    applyForReview: success(),
    reviewApplication: success(),
    createInvitation: success(),
    previewInvitation: success(),
    confirmInvitation: success(),
    addComment: success(),
    requestCode: success(),
    updateDiscovery: success(),
    setAccess: success(),
    setFollowing: success(),
  };
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Public research and real account interface", () => {
  it("offers Explore, Following and Archive navigation to visitors and researchers", () => {
    const view = openApp();
    const navigation = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(navigation).getAllByRole("link").map((link) => link.textContent)).toEqual(["Explore", "Following", "Archive"]);
    expect(within(navigation).getByRole("link", { name: "Explore" }).getAttribute("href")).toBe("/");
    expect(within(navigation).getByRole("link", { name: "Following" }).getAttribute("href")).toBe("/following");
    expect(within(navigation).getByRole("link", { name: "Archive" }).getAttribute("href")).toBe("/archive");
    expect(screen.queryByRole("button", { name: /Account menu/ })).toBeNull();
    view.unmount();
    signedIn();
    openApp();
    expect(within(screen.getByRole("navigation", { name: "Main navigation" })).getAllByRole("link")).toHaveLength(3);
    const trigger = screen.getByRole("button", { name: "Account menu for Test Researcher" });
    expect(trigger.textContent).toContain("Test Researcher");
    expect(trigger.textContent).toContain("Reader");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "My profile" })).toBeNull();
  });

  it("opens the account dropdown by keyboard, closes on Escape, and restores trigger focus", async () => {
    signedIn();
    const interaction = userEvent.setup();
    openApp();
    const trigger = screen.getByRole("button", { name: "Account menu for Test Researcher" });
    trigger.focus();
    await interaction.keyboard("{ArrowDown}");
    const menu = screen.getByRole("navigation", { name: "Account" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(within(menu).getByRole("link", { name: "My profile" }));
    await interaction.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(within(menu).getByRole("link", { name: "Reviewer access" }));
    await interaction.keyboard("{End}");
    expect(document.activeElement).toBe(within(menu).getByRole("button", { name: "Sign out" }));
    await interaction.keyboard("{Escape}");
    expect(screen.queryByRole("navigation", { name: "Account" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the account dropdown on outside interaction, keyboard exit, and navigation", async () => {
    signedIn();
    const interaction = userEvent.setup();
    openApp();
    const trigger = screen.getByRole("button", { name: "Account menu for Test Researcher" });
    await interaction.click(trigger);
    expect(screen.getByRole("navigation", { name: "Account" })).toBeTruthy();
    await interaction.click(screen.getByRole("heading", { level: 1 }));
    expect(screen.queryByRole("navigation", { name: "Account" })).toBeNull();
    trigger.focus();
    await interaction.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Sign out" }));
    await interaction.tab();
    expect(screen.queryByRole("navigation", { name: "Account" })).toBeNull();
    await interaction.click(trigger);
    await interaction.click(within(screen.getByRole("navigation", { name: "Account" })).getByRole("link", { name: "My profile" }));
    expect(screen.getByRole("button", { name: "Save profile" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Account" })).toBeNull();
    await interaction.click(trigger);
    await interaction.click(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("link", { name: "Explore" }));
    expect(screen.getByRole("tabpanel")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Account" })).toBeNull();
  });

  it("sends an already signed-in researcher from the login route to Explore", () => {
    signedIn();
    openApp("/login");
    expect(screen.getByRole("link", { name: "Explore" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("tabpanel")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save profile" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in with GitHub" })).toBeNull();
  });
  it("renders the headline evidence on the feed and all section figures on the investigation page", async () => {
    const d = portal.state.discoveries[0];
    d.question = "Does the signal survive the controls?";
    d.sections[0].body = "Context from the manuscript.\n\nLimitations from the manuscript.";
    d.figures = [
      { id: "plot", path: "assets/plot.png", caption: "Measured points with conditional errors.", alt: "Measured points and uncertainty bars.", sectionId: d.sections[0].id },
      { id: "control", path: "assets/control.png", caption: "The retained control comparison.", alt: "Control comparison.", sectionId: d.sections[1].id },
      { id: "check", path: "assets/check.png", caption: "The retained sensitivity comparison.", alt: "Sensitivity comparison.", sectionId: d.sections[2].id },
    ];
    d.headlineFigureId = "plot";
    const create = vi.fn(() => "blob:local-evidence");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const view = openApp();
    expect(screen.getByText(d.question)).toBeTruthy();
    expect(await screen.findByAltText(d.figures[0].alt)).toBeTruthy();
    expect(screen.getByText(d.figures[0].caption)).toBeTruthy();
    expect(screen.queryByAltText(d.figures[1].alt)).toBeNull();
    expect(screen.queryByRole("link", { name: /Open full-size figure/ })).toBeNull();
    view.unmount();
    expect(revoke).toHaveBeenCalledWith("blob:local-evidence");
    openApp(`/discoveries/${d.id}`);
    expect(await screen.findByAltText(d.figures[0].alt)).toBeTruthy();
    for (const figure of d.figures) {
      expect(await screen.findByAltText(figure.alt)).toBeTruthy();
      expect(screen.getByText(figure.caption)).toBeTruthy();
    }
    expect(screen.getAllByRole("link", { name: /Open full-size figure/ })).toHaveLength(3);
    expect((await screen.findByText("Context from the manuscript.")).tagName).toBe("P");
    expect((await screen.findByText("Limitations from the manuscript.")).tagName).toBe("P");
    expect(screen.queryByText(d.id)).toBeNull();
  });

  it("keeps a failed figure honest and preserves its scientific caption", async () => {
    const d = portal.state.discoveries[0];
    d.figures = [{ id: "plot", path: "assets/plot.png", caption: "Caption retained from the manuscript.", alt: "Scientific evidence.", sectionId: d.sections[0].id }];
    vi.mocked(portal.loadFigure).mockRejectedValue(new Error("Unavailable"));
    openApp(`/discoveries/${d.id}`);
    expect(await screen.findByText("Figure unavailable. The caption remains available below.")).toBeTruthy();
    expect(screen.getByText(d.figures[0].caption)).toBeTruthy();
    expect(screen.queryByAltText(d.figures[0].alt)).toBeNull();
    expect(screen.queryByRole("link", { name: /Open full-size figure/ })).toBeNull();
  });
  it("browses without login or selectable identities and combines field, status, and keyboard filters", async () => {
    const interaction = userEvent.setup();
    openApp();
    expect(
      within(screen.getByRole("tabpanel")).getAllByRole("article"),
    ).toHaveLength(6);
    expect(within(screen.getByRole("tabpanel")).queryByText(/Illustrative example/)).toBeNull();
    expect(screen.queryByText(/^AST-\d+$/)).toBeNull();
    expect(screen.queryByText(/^AI-\d+$/)).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: /persona|role/i }),
    ).toBeNull();
    expect(
      screen.queryByText(/continue as demo|choose a demo|fictional accounts/i),
    ).toBeNull();
    await interaction.click(screen.getByRole("tab", { name: "Astronomy" }));
    expect(
      within(screen.getByRole("tabpanel")).getAllByRole("article"),
    ).toHaveLength(3);
    await interaction.selectOptions(
      screen.getByRole("combobox", { name: "Discovery status" }),
      "Published",
    );
    expect(
      within(screen.getByRole("tabpanel")).getAllByRole("article"),
    ).toHaveLength(1);
    await interaction.click(
      screen.getByRole("tab", { name: "Artificial Intelligence" }),
    );
    await interaction.keyboard("{ArrowRight}");
    expect(
      screen
        .getByRole("tab", { name: "Astronomy" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    await interaction.click(
      within(screen.getByRole("tabpanel")).getByRole("link", { name: /Reassessing color gradients in faint galaxies/ }),
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Reassessing color gradients in faint galaxies",
    );
    expect(screen.getByText("No supporting materials available.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign in to request code access" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit discovery" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Post comment" })).toBeNull();
  });

  it("preserves direct discovery hash routing after a refresh on GitHub Pages", () => {
    window.history.replaceState(
      null,
      "",
      "/SciDA-website/#/discoveries/AST-003",
    );
    const first = render(
      <HashRouter>
        <App />
      </HashRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Reassessing color gradients in faint galaxies",
    );
    first.unmount();
    render(
      <HashRouter>
        <App />
      </HashRouter>,
    );
    expect(window.location.hash).toBe("#/discoveries/AST-003");
    expect(screen.getByText("No supporting materials available.")).toBeTruthy();
  });

  it("restores the Archive route and preserves archived discovery links after a refresh", async () => {
    const discovery = portal.state.discoveries.find((item) => item.id === "AST-003")!;
    discovery.statusHistory = [{
      from: discovery.status, to: "Withdrawn", reason: "The owner withdrew this test investigation after review.",
      decidedAt: "2026-10-15T12:00:00Z", decidedBy: "89913681", decidedByName: "Test owner", version: discovery.version,
    }];
    discovery.status = "Withdrawn";
    window.history.replaceState(null, "", "/#/archive");
    const view = render(<HashRouter><App /></HashRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "Archive" })).toBeTruthy();
    expect(within(screen.getByRole("tabpanel")).getAllByRole("article")).toHaveLength(1);
    await userEvent.setup().click(within(screen.getByRole("tabpanel")).getByRole("link", { name: new RegExp(discovery.title) }));
    expect(window.location.hash).toBe("#/discoveries/AST-003");
    view.unmount();
    render(<HashRouter><App /></HashRouter>);
    expect(screen.getByRole("heading", { level: 1, name: discovery.title })).toBeTruthy();
    expect(screen.getAllByText("Withdrawn").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: /Research discussion/ })).toBeTruthy();
    expect(screen.getByText("No supporting materials available.")).toBeTruthy();
  });

  it("prioritizes profile expertise without hiding research and keeps a chronological Recent tab", async () => {
    signedIn({ ...researcher, fields: ["Artificial Intelligence"], expertiseTopics: ["bandit-theory"] });
    portal.state.discoveries.forEach((discovery) => { discovery.updatedAt = "2026-10-01T12:00:00Z"; });
    portal.state.discoveries.find((discovery) => discovery.id === "AI-001")!.updatedAt = "2026-09-01T12:00:00Z";
    portal.state.discoveries.find((discovery) => discovery.id === "AST-001")!.updatedAt = "2026-10-14T12:00:00Z";
    const interaction = userEvent.setup();
    openApp();
    expect(screen.getByRole("tab", { name: "For you" }).getAttribute("aria-selected")).toBe("true");
    const cards = () => within(screen.getByRole("tabpanel")).getAllByRole("article");
    expect(cards()).toHaveLength(6);
    expect(within(cards()[0]).getByRole("link").getAttribute("href")).toBe("/discoveries/AI-001");
    await interaction.click(screen.getByRole("tab", { name: "Recent discoveries" }));
    expect(within(cards()[0]).getByRole("link").getAttribute("href")).toBe("/discoveries/AST-001");
  });

  it("does not collect credentials or simulate login when account services are unconfigured", () => {
    portal.configured = false;
    openApp("/login");
    expect(
      screen.getByText("The research portal is not connected."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Sign in with GitHub" }),
    ).toBeNull();
    expect(portal.signInWithGitHub).not.toHaveBeenCalled();
  });

  it("shows an honest empty feed and unavailable states without local research", () => {
    portal.state.discoveries = [];
    const empty = openApp();
    expect(screen.getByText("No discoveries available yet")).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    empty.unmount();
    portal.configured = false;
    const unconfigured = openApp();
    expect(screen.getByRole("heading", { name: "Discoveries unavailable" })).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
    unconfigured.unmount();
    portal.configured = true;
    portal.error = "Research is temporarily unavailable.";
    openApp();
    expect(screen.getByRole("heading", { name: "Discoveries unavailable" })).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("starts GitHub sign-in without collecting credentials and disables duplicate requests", async () => {
    let resolve!: (result: ActionResult) => void;
    portal.signInWithGitHub = vi.fn(
      () =>
        new Promise<ActionResult>((done) => {
          resolve = done;
        }),
    );
    const interaction = userEvent.setup();
    openApp("/login");
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    await interaction.click(
      screen.getByRole("button", { name: "Sign in with GitHub" }),
    );
    expect(portal.signInWithGitHub).toHaveBeenCalledOnce();
    expect(
      (
        screen.getByRole("button", {
          name: /Opening GitHub/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () =>
      resolve({
        ok: false,
        message: "GitHub sign-in is unavailable. Try again.",
      }),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "GitHub sign-in is unavailable. Try again.",
    );
    expect(screen.queryByRole("link", { name: "My profile" })).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Sign in with GitHub",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("sends registration and recovery to GitHub instead of providing local password forms", () => {
    openApp("/login");
    expect(
      screen
        .getByRole("link", { name: "Create a GitHub account" })
        .getAttribute("href"),
    ).toBe("https://github.com/signup");
    expect(
      screen
        .getByRole("link", { name: "Recover your GitHub account" })
        .getAttribute("href"),
    ).toBe("https://github.com/password_reset");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create account" })).toBeNull();
  });

  it("allows GitHub sign-in while the public discovery feed is still loading", async () => {
    portal.loading = true;
    const interaction = userEvent.setup();
    openApp("/login");
    const button = screen.getByRole("button", { name: "Sign in with GitHub" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await interaction.click(button);
    expect(portal.signInWithGitHub).toHaveBeenCalledOnce();
  });

  it("renders accessible mathematical notation when a discovery is opened", async () => {
    const view = openApp("/discoveries/AI-001");
    await waitFor(() =>
      expect(view.container.querySelector(".katex math")).not.toBeNull(),
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      discoveries.find((discovery) => discovery.id === "AI-001")!.title,
    );
  });

  it("keeps the GitHub callback pending until the API confirms the account", () => {
    portal.loading = true;
    const view = openApp("/auth/callback?code=opaque-code&state=opaque-state");
    expect(
      screen.getByRole("heading", { name: /Completing GitHub sign-in/ }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Full name")).toBeNull();
    signedIn();
    portal.loading = false;
    view.rerender(
      <MemoryRouter
        initialEntries={["/auth/callback?code=opaque-code&state=opaque-state"]}
      >
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Explore" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("tabpanel")).toBeTruthy();
    expect(screen.queryByLabelText("Full name")).toBeNull();
  });

  it("shows callback failure without creating an account or exposing callback tokens", () => {
    portal.error = "GitHub authorization expired. Please sign in again.";
    openApp("/auth/callback?code=opaque-code&state=opaque-state");
    expect(
      screen.getByRole("heading", { name: "Sign-in could not be completed" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Return to sign in" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Full name")).toBeNull();
    expect(document.body.textContent).not.toContain("opaque-code");
    expect(document.body.textContent).not.toContain("opaque-state");
  });

  it("limits profile expertise to selected fields, clears removed topics, and keeps email readonly", async () => {
    signedIn();
    const interaction = userEvent.setup();
    openApp("/profile");
    expect(
      (screen.getByLabelText(/Private email/) as HTMLInputElement).readOnly,
    ).toBe(true);
    expect(
      screen.queryByRole("checkbox", { name: /^Bandit theory/ }),
    ).toBeNull();
    await interaction.click(
      screen.getByRole("checkbox", { name: "Artificial Intelligence" }),
    );
    await interaction.click(
      screen.getByRole("checkbox", { name: /^Bandit theory/ }),
    );
    expect(screen.queryByRole("checkbox", { name: /^Exoplanets/ })).toBeNull();
    await interaction.click(
      screen.getByRole("checkbox", { name: "Astronomy" }),
    );
    await interaction.click(
      screen.getByRole("checkbox", { name: /^Exoplanets/ }),
    );
    await interaction.click(
      screen.getByRole("checkbox", { name: "Artificial Intelligence" }),
    );
    expect(
      screen.queryByRole("checkbox", { name: /^Bandit theory/ }),
    ).toBeNull();
    expect(
      (screen.getByLabelText(/Google Scholar profile URL/) as HTMLInputElement)
        .required,
    ).toBe(false);
    await interaction.click(
      screen.getByRole("button", { name: "Save profile" }),
    );
    expect(portal.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: ["Astronomy"],
        expertiseTopics: ["exoplanets"],
      }),
    );
    const submitted = vi.mocked(portal.saveProfile).mock.calls[0][0];
    expect(submitted).not.toHaveProperty("email");
    expect(submitted).not.toHaveProperty("role");
  });

  it("requires sign-in for private profile data and code requests", () => {
    const view = openApp("/profile");
    expect(screen.queryByLabelText("Full name")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Sign in or create an account" }),
    ).toBeTruthy();
    view.unmount();
    portal.state.discoveries.find((row) => row.id === "AI-001")!.restrictedMaterials = ["repository"];
    openApp("/discoveries/AI-001");
    expect(screen.queryByRole("button", { name: "Request code access" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Sign in to request code access" }),
    ).toBeTruthy();
  });

  it("keeps readers and reviewers outside approved topics from posting or editing research", () => {
    signedIn();
    const view = openApp("/discoveries/AI-001");
    expect(screen.queryByRole("button", { name: "Post comment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit discovery" })).toBeNull();
    view.unmount();
    signedIn({
      ...researcher,
      role: "Reviewer",
      approvedTopics: ["bandit-theory"],
    });
    openApp("/discoveries/AST-001");
    expect(screen.queryByLabelText("Your comment")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit discovery" })).toBeNull();
  });

  it("posts references against the current manuscript and replies against their parent version", async () => {
    signedIn({
      ...researcher,
      role: "Reviewer",
      approvedTopics: ["bandit-theory"],
    });
    portal.state.comments = [
      {
        id: "thread-1",
        discoveryId: "AI-001",
        authorId: "other-researcher",
        authorName: "Research Colleague",
        parentId: null,
        version: "v0.1",
        reference: "Theorem 1",
        body: "Could the assumptions be clarified?",
        createdAt: "2026-10-01T12:00:00Z",
      },
    ];
    const interaction = userEvent.setup();
    openApp("/discoveries/AI-001");
    await interaction.type(screen.getByLabelText(/Reference/), "Assumption A1");
    await interaction.type(
      screen.getByLabelText("Your comment"),
      "Please define the filtration.",
    );
    await interaction.click(
      screen.getByRole("button", { name: "Post comment" }),
    );
    expect(portal.addComment).toHaveBeenCalledWith(
      expect.objectContaining({
        discoveryId: "AI-001",
        parentId: null,
        version: "v0.2",
        reference: "Assumption A1",
        body: "Please define the filtration.",
      }),
    );
    await interaction.click(
      screen.getByRole("button", { name: "Reply to thread" }),
    );
    await interaction.type(
      screen.getByLabelText("Your reply"),
      "This concerns the earlier version.",
    );
    await interaction.click(screen.getByRole("button", { name: "Post reply" }));
    expect(portal.addComment).toHaveBeenLastCalledWith(
      expect.objectContaining({
        parentId: "thread-1",
        version: "v0.1",
        reference: "Theorem 1",
      }),
    );
    expect(screen.getByText("Research Colleague")).toBeTruthy();
  });

  it("reports backend failures rather than claiming a code request was recorded", async () => {
    signedIn();
    portal.state.discoveries.find((row) => row.id === "AST-001")!.restrictedMaterials = ["repository"];
    vi.mocked(portal.requestCode).mockResolvedValue({
      ok: false,
      message: "Request could not be saved.",
    });
    const interaction = userEvent.setup();
    openApp("/discoveries/AST-001");
    await interaction.click(
      screen.getByRole("button", { name: "Request code access" }),
    );
    await interaction.type(
      screen.getByLabelText("Why would you like access?"),
      "I want to reproduce the cadence analysis.",
    );
    await interaction.click(
      screen.getByRole("button", { name: "Submit code request" }),
    );
    expect(portal.requestCode).toHaveBeenCalledWith(
      "AST-001",
      "I want to reproduce the cadence analysis.",
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Request could not be saved.",
    );
    expect(screen.queryByText("Your code requests (1)")).toBeNull();
  });

  it("recovers after an interrupted code request without clearing the explanation or duplicating submission", async () => {
    signedIn();
    portal.state.discoveries.find((row) => row.id === "AST-001")!.restrictedMaterials = ["repository"];
    let reject!: (reason: Error) => void;
    portal.requestCode = vi.fn(() => new Promise<ActionResult>((_resolve, rejectRequest) => { reject = rejectRequest; }));
    const interaction = userEvent.setup();
    openApp("/discoveries/AST-001");
    await interaction.click(screen.getByRole("button", { name: "Request code access" }));
    const explanation = screen.getByLabelText("Why would you like access?");
    await interaction.type(explanation, "I would like to reproduce the documented analysis.");
    await interaction.click(screen.getByRole("button", { name: "Submit code request" }));
    expect((screen.getByRole("button", { name: "Submitting…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(portal.requestCode).toHaveBeenCalledOnce();
    await act(async () => reject(new Error("Network disconnected")));
    expect(screen.getByRole("alert").textContent).toBe("The code request could not be submitted. Please try again.");
    expect((screen.getByRole("button", { name: "Submit code request" }) as HTMLButtonElement).disabled).toBe(false);
    expect((explanation as HTMLTextAreaElement).value).toBe("I would like to reproduce the documented analysis.");
    expect(screen.queryByText("Your code requests (1)")).toBeNull();
  });

  it("previews an invitation through the backend and requires explicit scope confirmation", async () => {
    signedIn();
    vi.mocked(portal.previewInvitation).mockResolvedValue({
      ok: true,
      message: "Scope loaded.",
      invitation: {
        id: "invitation-1",
        intendedEmail: researcher.email,
        topics: ["bandit-theory"],
      },
    });
    const interaction = userEvent.setup();
    openApp("/access");
    await interaction.type(
      screen.getByLabelText("Invitation code"),
      "test-secret-token",
    );
    await interaction.click(
      screen.getByRole("button", { name: "Review invitation scope" }),
    );
    expect(portal.previewInvitation).toHaveBeenCalledWith("test-secret-token");
    const accept = screen.getByRole("button", {
      name: "Accept confirmed invitation",
    }) as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    expect(portal.confirmInvitation).not.toHaveBeenCalled();
    await interaction.click(
      screen.getByRole("checkbox", { name: /I confirm this invitation/ }),
    );
    await interaction.click(accept);
    expect(portal.confirmInvitation).toHaveBeenCalledWith("test-secret-token", [
      "bandit-theory",
    ]);
  });

  it("allows assigned senior approvers to review applications but never appoint approvers", async () => {
    signedIn({
      ...researcher,
      role: "Senior Approver",
      assignedTopics: ["bandit-theory"],
    });
    portal.state.applications = [
      {
        id: "application-1",
        userId: "applicant",
        topics: ["bandit-theory"],
        evidence: "A relevant publication.",
        status: "Pending",
        createdAt: "2026-10-01T12:00:00Z",
      },
      {
        id: "application-2",
        userId: "applicant",
        topics: ["exoplanets"],
        evidence: "Astronomy research.",
        status: "Pending",
        createdAt: "2026-10-01T12:00:00Z",
      },
    ];
    const interaction = userEvent.setup();
    openApp("/access");
    const queue = screen.getByRole("region", { name: "Review applications" });
    expect(within(queue).getAllByRole("article")).toHaveLength(1);
    expect(
      screen.queryByRole("heading", { name: "Manage researcher access" }),
    ).toBeNull();
    await interaction.click(
      within(queue).getByRole("button", { name: "Approve requested topics" }),
    );
    expect(portal.reviewApplication).toHaveBeenCalledWith(
      "application-1",
      "Approved",
      "",
    );
  });

  it("exposes researcher access management only to the administrator without an Admin option", () => {
    signedIn({ ...researcher, role: "Admin" });
    portal.state.profiles.push({
      ...researcher,
      id: "other-user",
      fullName: "Another Researcher",
    });
    openApp("/access");
    expect(
      screen.getByRole("heading", { name: "Manage researcher access" }),
    ).toBeTruthy();
    const role = screen.getByRole("combobox", {
      name: "Role for Another Researcher",
    });
    expect(
      within(role)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Reader", "Reviewer", "Approver", "Senior Approver"]);
    expect(
      screen.queryByRole("combobox", { name: "Role for Test Researcher" }),
    ).toBeNull();
  });

  it("keeps load failures explicit instead of presenting an empty discussion as authoritative", () => {
    portal.error = "The database could not be reached.";
    openApp("/discoveries/AI-001");
    expect(screen.getByRole("alert").textContent).toContain(
      "The database could not be reached.",
    );
    expect(screen.getByText(/Discussion could not be refreshed/)).toBeTruthy();
    expect(screen.queryByText(/No discussion for this version yet/)).toBeNull();
  });

  it.each(["Reader", "Reviewer", "Approver", "Senior Approver"] as const)(
    "does not expose the administrator code request queue to a %s",
    (role) => {
      signedIn({ ...researcher, role });
      portal.state.codeRequests = [
        {
          id: "request-1",
          discoveryId: "AI-001",
          userId: researcher.id,
          explanation: "I would reproduce the delayed-feedback experiment.",
          createdAt: "2026-10-14T08:00:00Z",
        },
      ];
      openApp("/access");
      expect(
        screen.queryByRole("region", { name: "Research code requests" }),
      ).toBeNull();
      expect(
        screen.queryByText(
          "I would reproduce the delayed-feedback experiment.",
        ),
      ).toBeNull();
    },
  );

  it("shows the administrator submitted code requests with requester, discovery, explanation, and date", () => {
    signedIn({ ...researcher, role: "Admin" });
    portal.state.profiles.push({
      ...researcher,
      id: "requesting-researcher",
      fullName: "Requesting Researcher",
      email: "private-requester@example.org",
    });
    portal.state.codeRequests = [
      {
        id: "request-1",
        discoveryId: "AI-001",
        userId: "requesting-researcher",
        explanation: "I would reproduce the delayed-feedback experiment.",
        createdAt: "2026-10-14T08:00:00Z",
      },
    ];
    openApp("/access");
    const queue = screen.getByRole("region", {
      name: "Research code requests",
    });
    expect(
      within(queue).getByRole("heading", { name: "Requesting Researcher" }),
    ).toBeTruthy();
    expect(
      within(queue).getByText("Account ID: requesting-researcher"),
    ).toBeTruthy();
    expect(
      within(queue)
        .getByRole("link", {
          name: "Adaptive exploration under delayed feedback",
        })
        .getAttribute("href"),
    ).toBe("/discoveries/AI-001");
    expect(
      within(queue).getByText(
        "I would reproduce the delayed-feedback experiment.",
      ),
    ).toBeTruthy();
    expect(
      within(queue).getByText("14 Oct 2026").getAttribute("datetime"),
    ).toBe("2026-10-14T08:00:00Z");
    expect(queue.textContent).not.toContain("private-requester@example.org");
  });

  it("retains an edited profile while shared data refreshes", async () => {
    signedIn();
    const interaction = userEvent.setup();
    const view = openApp("/profile");
    const name = screen.getByLabelText("Full name");
    await interaction.clear(name);
    await interaction.type(name, "Updated Researcher");
    portal.loading = true;
    view.rerender(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe(
      "Updated Researcher",
    );
  });

  it("offers a manual refresh and prevents overlapping refresh requests", async () => {
    const interaction = userEvent.setup();
    const view = openApp();
    await interaction.click(
      screen.getByRole("button", { name: "Refresh research portal" }),
    );
    expect(portal.refresh).toHaveBeenCalledOnce();
    portal.loading = true;
    view.rerender(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Refresh research portal",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("opens supporting material through the API and shows authorization failure without exposing its location", async () => {
    signedIn();
    portal.state.discoveries.find(
      (discovery) => discovery.id === "AI-001",
    )!.materials.paper = "private-location-marker";
    let resolve!: (result: ActionResult) => void;
    portal.downloadMaterial = vi.fn(
      () =>
        new Promise<ActionResult>((done) => {
          resolve = done;
        }),
    );
    const interaction = userEvent.setup();
    openApp("/discoveries/AI-001");
    await interaction.click(
      screen.getByRole("button", { name: "Open full paper" }),
    );
    expect(portal.downloadMaterial).toHaveBeenCalledWith("AI-001", "paper");
    expect(
      (screen.getByRole("button", { name: /Opening/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(document.body.innerHTML).not.toContain("private-location-marker");
    await act(async () =>
      resolve({
        ok: false,
        message: "This material requires approved review access.",
      }),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "This material requires approved review access.",
    );
  });

  it("distinguishes restricted materials from missing uploads and links to the appropriate access flow", () => {
    portal.state.discoveries.find(
      (discovery) => discovery.id === "AI-001",
    )!.restrictedMaterials = ["paper"];
    const view = openApp("/discoveries/AI-001");
    expect(screen.getByText("Restricted material")).toBeTruthy();
    expect(screen.queryByText("Not uploaded yet")).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign in to request code access" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Sign in to access full paper" })
        .getAttribute("href"),
    ).toBe("/login");
    view.unmount();
    signedIn();
    openApp("/discoveries/AI-001");
    expect(
      screen
        .getByRole("link", { name: "Request access to full paper" })
        .getAttribute("href"),
    ).toBe("/access");
  });

  it("offers the complete package file list after an authorized code response", async () => {
    signedIn();
    portal.state.discoveries.find(row => row.id === "AI-001")!.materials.repository = "authorized-material";
    const file = { id: "assemble", filename: "assemble.py", size: 1024, sha256: "a".repeat(64), url: "private-endpoint" };
    vi.mocked(portal.downloadMaterial).mockResolvedValue({ ok: true, message: "Ready", package: {
      filename: "reviewer.zip", size: 1024, sha256: "b".repeat(64), files: [file],
    } });
    const interaction = userEvent.setup();
    openApp("/discoveries/AI-001");
    expect(screen.getByText("Your account has access.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request code access" })).toBeNull();
    expect(screen.queryByRole("link", { name: /request code/i })).toBeNull();
    await interaction.click(screen.getByRole("button", { name: "Open analysis package" }));
    expect(screen.getByRole("heading", { name: "Complete analysis package" })).toBeTruthy();
    await interaction.click(screen.getByText("Individual files"));
    await interaction.click(screen.getByRole("button", { name: /assemble.py/ }));
    expect(portal.downloadPackageFile).toHaveBeenCalledWith("AI-001", "repository", file, undefined);
    expect(document.body.innerHTML).not.toContain("private-endpoint");
  });

  it("offers one code-access request action for a restricted package and no request to authorized administrators", async () => {
    const discovery = portal.state.discoveries.find((row) => row.id === "AI-001")!;
    discovery.restrictedMaterials = ["repository"];
    let view = openApp("/discoveries/AI-001");
    expect(screen.getAllByRole("link", { name: "Sign in to request code access" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Sign in to access analysis package" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open analysis package" })).toBeNull();
    view.unmount();
    signedIn();
    view = openApp("/discoveries/AI-001");
    expect(screen.getAllByRole("button", { name: "Request code access" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Request access to analysis package" })).toBeNull();
    expect(screen.getByText("Approval required")).toBeTruthy();
    view.unmount();
    signedIn({ ...researcher, role: "Admin" });
    discovery.materials.repository = "authorized-material";
    openApp("/discoveries/AI-001");
    expect(screen.getByRole("button", { name: "Open analysis package" })).toBeTruthy();
    expect(screen.getByText("Your account has access.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request code access" })).toBeNull();
  });

  it("lets anonymous readers open a material the server has made public", async () => {
    portal.state.discoveries.find(
      (discovery) => discovery.id === "AI-001",
    )!.materials.paper = "public-material-availability-marker";
    vi.mocked(portal.downloadMaterial).mockResolvedValue({
      ok: true,
      message: "Supporting material downloaded.",
    });
    const interaction = userEvent.setup();
    openApp("/discoveries/AI-001");
    expect(portal.user).toBeNull();
    await interaction.click(
      screen.getByRole("button", { name: "Open full paper" }),
    );
    expect(portal.downloadMaterial).toHaveBeenCalledWith("AI-001", "paper");
    expect(screen.getByRole("status").textContent).toBe(
      "Supporting material downloaded.",
    );
    expect(portal.signInWithGitHub).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain(
      "public-material-availability-marker",
    );
  });

  it("shows validation records without internal IDs or fictional-research labels", () => {
    const discovery = portal.state.discoveries.find(
      (item) => item.id === "AI-003",
    )!;
    discovery.illustrative = false;
    discovery.reviewNote =
      "Publication record: supporting evidence is available for inspection.";
    const view = openApp();
    const card = screen
      .getByRole("link", { name: new RegExp(discovery.title) })
      .closest("article")!;
    expect(within(card).queryByText("Illustrative example")).toBeNull();
    expect(within(card).getByText("Publication record")).toBeTruthy();
    view.unmount();
    openApp("/discoveries/AI-003");
    expect(screen.queryByText("Illustrative example")).toBeNull();
    expect(
      screen.queryByText("This is a fictional research example."),
    ).toBeNull();
    expect(screen.getByText("Review record")).toBeTruthy();
  });

  it("keeps supporting-material configuration readonly in the administrator brief editor", async () => {
    signedIn({ ...researcher, role: "Admin" });
    portal.state.discoveries.find(
      (discovery) => discovery.id === "AI-001",
    )!.materials.paper = "private-location-marker";
    const interaction = userEvent.setup();
    openApp("/discoveries/AI-001");
    await interaction.click(
      screen.getByRole("button", { name: "Edit discovery" }),
    );
    const paper = screen.getByRole("textbox", {
      name: "Full paper",
    }) as HTMLInputElement;
    expect(paper.readOnly).toBe(true);
    expect(paper.value).toBe("Available");
    expect(document.body.innerHTML).not.toContain("private-location-marker");
    expect(screen.getByText("discovery.json")).toBeTruthy();
  });

  it("awaits logout and exposes server failure without offering role switching", async () => {
    signedIn();
    vi.mocked(portal.signOut).mockResolvedValue({
      ok: false,
      message: "Sign-out could not be completed. Try again.",
    });
    const interaction = userEvent.setup();
    openApp();
    await interaction.click(screen.getByRole("button", { name: "Account menu for Test Researcher" }));
    await interaction.click(screen.getByRole("button", { name: "Sign out" }));
    expect(portal.signOut).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert").textContent).toContain(
      "Sign-out could not be completed.",
    );
    expect(
      screen.queryByRole("combobox", { name: /persona|role/i }),
    ).toBeNull();
  });

  it("disables duplicate sign-out requests and recovers the dropdown after an unexpected error", async () => {
    signedIn();
    let reject!: (reason: Error) => void;
    portal.signOut = vi.fn(() => new Promise<ActionResult>((_resolve, rejectRequest) => { reject = rejectRequest; }));
    const interaction = userEvent.setup();
    openApp();
    await interaction.click(screen.getByRole("button", { name: "Account menu for Test Researcher" }));
    await interaction.click(screen.getByRole("button", { name: "Sign out" }));
    expect((screen.getByRole("button", { name: "Signing out…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(portal.signOut).toHaveBeenCalledOnce();
    await act(async () => reject(new Error("Network disconnected")));
    expect(screen.getByRole("alert").textContent).toContain("Sign-out could not be completed.");
    expect((screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("preserves the original manuscript timestamp and revision through editing and a concurrent refresh", async () => {
    signedIn({ ...researcher, role: "Admin" });
    const discovery = portal.state.discoveries.find(
      (item) => item.id === "AI-001",
    )!;
    const originalUpdatedAt = discovery.updatedAt;
    Object.assign(discovery, { revision: "original-blob-sha" });
    vi.mocked(portal.updateDiscovery).mockResolvedValue({
      ok: false,
      message: "The discovery changed on GitHub. Refresh before editing again.",
    });
    const interaction = userEvent.setup();
    const view = openApp("/discoveries/AI-001");
    await interaction.click(
      screen.getByRole("button", { name: "Edit discovery" }),
    );
    const title = screen.getByRole("textbox", { name: "Title" });
    await interaction.clear(title);
    await interaction.type(title, "Revised research brief");
    portal.state.discoveries = portal.state.discoveries.map((item) =>
      item.id === "AI-001"
        ? {
            ...item,
            updatedAt: "2026-10-15T12:00:00Z",
            revision: "newer-blob-sha",
          }
        : item,
    );
    view.rerender(
      <MemoryRouter initialEntries={["/discoveries/AI-001"]}>
        <App />
      </MemoryRouter>,
    );
    await interaction.click(
      screen.getByRole("button", { name: "Save discovery" }),
    );
    expect(portal.updateDiscovery).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Revised research brief",
        updatedAt: originalUpdatedAt,
        revision: "original-blob-sha",
      }),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "The discovery changed on GitHub. Refresh before editing again.",
    );
    expect(
      (screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement)
        .value,
    ).toBe("Revised research brief");
  });
});
