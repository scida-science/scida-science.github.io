// @vitest-environment jsdom
// Fixtures and simulated responses in this file are test-only; the application uses the authenticated research API.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act, cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HashRouter, MemoryRouter } from "react-router-dom";
import App from "./App";
import { discoveries } from "./data/discoveries";
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
  it("renders repository questions, evidence alt text and captions on the card and detail page", async () => {
    const d = portal.state.discoveries[0];
    d.question = "Does the signal survive the controls?";
    d.figures = [{ id: "plot", path: "assets/plot.png", caption: "Measured points with conditional errors.", alt: "Measured points and uncertainty bars.", sectionId: d.sections[0].id }];
    d.headlineFigureId = "plot";
    const create = vi.fn(() => "blob:local-evidence");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const view = openApp();
    expect(screen.getByText(d.question)).toBeTruthy();
    expect(await screen.findByAltText(d.figures[0].alt)).toBeTruthy();
    expect(screen.getByText(d.figures[0].caption)).toBeTruthy();
    view.unmount();
    expect(revoke).toHaveBeenCalledWith("blob:local-evidence");
    openApp(`/discoveries/${d.id}`);
    expect(await screen.findByAltText(d.figures[0].alt)).toBeTruthy();
    expect(screen.getByText(d.figures[0].caption)).toBeTruthy();
  });
  it("browses without login or selectable identities and combines field, status, and keyboard filters", async () => {
    const interaction = userEvent.setup();
    openApp();
    expect(
      within(screen.getByRole("tabpanel")).getAllByRole("article"),
    ).toHaveLength(6);
    expect(
      within(screen.getByRole("tabpanel")).getAllByText(/Illustrative example/),
    ).toHaveLength(6);
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
      within(screen.getByRole("tabpanel")).getByRole("link"),
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Reassessing color gradients in faint galaxies",
    );
    expect(screen.getAllByText("Not uploaded yet")).toHaveLength(5);
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
    expect(screen.getAllByText("Not uploaded yet")).toHaveLength(5);
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
    expect(cards()[0].textContent).toContain("AI-001");
    await interaction.click(screen.getByRole("tab", { name: "Recent discoveries" }));
    expect(cards()[0].textContent).toContain("AST-001");
  });

  it("does not collect credentials or simulate login when account services are unconfigured", () => {
    portal.configured = false;
    openApp("/login");
    expect(
      screen.getByText("Account services are not configured yet."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Sign in with GitHub" }),
    ).toBeNull();
    expect(portal.signInWithGitHub).not.toHaveBeenCalled();
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
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe(
      "Test Researcher",
    );
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
    openApp("/discoveries/AI-001");
    expect(screen.queryByRole("button", { name: "Request code" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Sign in to request code" }),
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
    vi.mocked(portal.requestCode).mockResolvedValue({
      ok: false,
      message: "Request could not be saved.",
    });
    const interaction = userEvent.setup();
    openApp("/discoveries/AST-001");
    await interaction.click(
      screen.getByRole("button", { name: "Request code" }),
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
    expect(screen.getByRole("status").textContent).toBe(
      "Request could not be saved.",
    );
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
    expect(screen.getAllByText("Not uploaded yet")).toHaveLength(4);
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

  it("labels examples explicitly without describing real discoveries as fictional", () => {
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
    await interaction.click(screen.getByRole("button", { name: "Sign out" }));
    expect(portal.signOut).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert").textContent).toContain(
      "Sign-out could not be completed.",
    );
    expect(
      screen.queryByRole("combobox", { name: /persona|role/i }),
    ).toBeNull();
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
    expect(screen.getByRole("status").textContent).toBe(
      "The discovery changed on GitHub. Refresh before editing again.",
    );
    expect(
      (screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement)
        .value,
    ).toBe("Revised research brief");
  });
});
