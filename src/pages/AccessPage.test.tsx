// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AccessPage from "./AccessPage";
import ProfilePage from "./ProfilePage";
import type { usePortal } from "../state/PortalContext";
import type { Profile } from "../types";

let portal: ReturnType<typeof usePortal>;
vi.mock("../state/PortalContext", () => ({ usePortal: () => portal }));

const reader: Profile = {
  id: "123",
  githubLogin: "test-researcher",
  fullName: "Test Researcher",
  email: "researcher@example.org",
  affiliation: "Example Institute",
  researchRole: "Researcher",
  scholarUrl: "",
  website: "",
  fields: [],
  expertiseTopics: [],
  expertiseStatement: "",
  evidence: "Relevant research evidence for this test application.",
  role: "Reader",
  approvedTopics: [],
  assignedTopics: [],
};

function openAccess() {
  render(<MemoryRouter><AccessPage /></MemoryRouter>);
}

beforeEach(() => {
  const success = () => vi.fn().mockResolvedValue({ ok: true, message: "Saved." });
  portal = {
    state: {
      discoveries: [], profiles: [structuredClone(reader)], comments: [],
      codeRequests: [], applications: [], invitations: [],
    },
    user: structuredClone(reader),
    configured: true,
    loading: false,
    error: null,
    loadFigure: vi.fn().mockResolvedValue(new Blob([], { type: "image/png" })),
    signInWithGitHub: success(), downloadMaterial: success(), downloadPackageFile: success(), signOut: success(),
    refresh: success(), saveProfile: success(), applyForReview: success(),
    reviewApplication: success(), createInvitation: success(),
    previewInvitation: success(), confirmInvitation: success(), addComment: success(),
    requestCode: success(), updateDiscovery: success(), setAccess: success(),
  };
});
afterEach(cleanup);

describe("Reviewer topic selection and researcher search", () => {
  it("chooses fields first, retains selected topics across fields, and removes a hidden-field selection", async () => {
    const interaction = userEvent.setup();
    openAccess();
    const application = screen.getByRole("region", { name: "Apply for reviewer access" });
    expect(within(application).queryByRole("checkbox")).toBeNull();
    const field = within(application).getByRole("combobox", {
      name: "Research field for Requested review topics",
    });
    await interaction.selectOptions(field, "Artificial Intelligence");
    await interaction.click(within(application).getByRole("checkbox", { name: /^Bandit theory/ }));
    expect(within(application).queryByRole("checkbox", { name: /^Exoplanets/ })).toBeNull();
    await interaction.selectOptions(field, "Astronomy");
    expect(within(application).queryByRole("checkbox", { name: /^Bandit theory/ })).toBeNull();
    expect(within(application).getByRole("button", {
      name: "Remove Bandit theory from requested review topics",
    })).toBeTruthy();
    await interaction.click(within(application).getByRole("checkbox", { name: /^Exoplanets/ }));
    await interaction.selectOptions(field, "Artificial Intelligence");
    expect((within(application).getByRole("checkbox", { name: /^Bandit theory/ }) as HTMLInputElement).checked).toBe(true);
    await interaction.click(within(application).getByRole("button", {
      name: "Remove Exoplanets from requested review topics",
    }));
    await interaction.click(within(application).getByRole("button", { name: "Submit reviewer application" }));
    expect(portal.applyForReview).toHaveBeenCalledWith(["bandit-theory"], reader.evidence);
  });

  it("limits invitation field choices to the senior approver's assigned topics", async () => {
    const interaction = userEvent.setup();
    portal.user = { ...reader, role: "Senior Approver", assignedTopics: ["bandit-theory"] };
    openAccess();
    const invitation = screen.getByRole("region", { name: "Invite a reviewer" });
    const field = within(invitation).getByRole("combobox", { name: "Research field for Invitation review topics" });
    expect(within(field).queryByRole("option", { name: "Astronomy" })).toBeNull();
    await interaction.selectOptions(field, "Artificial Intelligence");
    expect(within(invitation).getAllByRole("checkbox")).toHaveLength(1);
    expect(within(invitation).getByRole("checkbox", { name: /^Bandit theory/ })).toBeTruthy();
  });

  it("searches existing researcher records and preserves unsaved access edits when changing search", async () => {
    const interaction = userEvent.setup();
    portal.user = { ...reader, id: "owner", githubLogin: "site-owner", fullName: "Site Owner", email: "owner@example.org", affiliation: "Owner Institute", role: "Admin" };
    portal.state.profiles = [portal.user, structuredClone(reader)];
    openAccess();
    const management = screen.getByRole("region", { name: "Manage researcher access" });
    const search = within(management).getByRole("searchbox", { name: "Search researchers" });
    const role = within(management).getByRole("combobox", { name: "Role for Test Researcher" });
    await interaction.selectOptions(role, "Reviewer");
    await interaction.selectOptions(within(management).getByRole("combobox", {
      name: "Research field for Approved review topics for Test Researcher",
    }), "Artificial Intelligence");
    await interaction.click(within(management).getByRole("checkbox", { name: /^Bandit theory/ }));
    await interaction.type(search, "owner");
    expect(within(management).queryByRole("combobox", { name: "Role for Test Researcher" })).toBeNull();
    await interaction.clear(search);
    for (const query of ["Example Institute", "researcher@example.org", "123", "test-researcher"]) {
      await interaction.type(search, query);
      expect(within(management).getByRole("heading", { name: "Test Researcher" })).toBeTruthy();
      expect(within(management).queryByRole("heading", { name: "Site Owner" })).toBeNull();
      await interaction.clear(search);
    }
    expect((role as HTMLSelectElement).value).toBe("Reviewer");
    await interaction.click(within(management).getByRole("button", { name: "Save access for Test Researcher" }));
    expect(portal.setAccess).toHaveBeenCalledWith("123", "Reviewer", ["bandit-theory"], []);
    await interaction.type(search, "no-matching-researcher");
    expect(within(management).getByText("No researchers match your search.")).toBeTruthy();
  });

  it("does not give ordinary approvers application, invitation, or access-management controls", () => {
    portal.user = { ...reader, role: "Approver", approvedTopics: ["bandit-theory"], assignedTopics: ["bandit-theory"] };
    openAccess();
    expect(screen.queryByRole("region", { name: "Review applications" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Invite a reviewer" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Manage researcher access" })).toBeNull();
    expect(screen.queryByText("Assigned approval topics:")).toBeNull();
  });

  it("assigns approval topics once and keeps optional review topics separate", async () => {
    const interaction = userEvent.setup();
    portal.user = { ...reader, id: "owner", fullName: "Site Owner", role: "Admin" };
    portal.state.profiles = [portal.user, structuredClone(reader)];
    openAccess();
    const management = screen.getByRole("region", { name: "Manage researcher access" });
    await interaction.selectOptions(within(management).getByRole("combobox", {
      name: "Role for Test Researcher",
    }), "Senior Approver");
    const approval = within(management).getByRole("group", {
      name: "Assigned approval topics for Test Researcher",
    });
    const additional = within(management).getByRole("group", {
      name: "Additional review topics for Test Researcher (optional)",
    });
    expect(within(management).getAllByRole("group")).toEqual([approval, additional]);
    await interaction.selectOptions(within(additional).getByRole("combobox"), "Artificial Intelligence");
    await interaction.click(within(additional).getByRole("checkbox", { name: /^Scientific AI/ }));
    await interaction.click(within(management).getByRole("button", { name: "Save access for Test Researcher" }));
    expect(portal.setAccess).not.toHaveBeenCalled();
    expect(within(management).getByRole("alert").textContent).toContain("Choose at least one assigned approval topic");
    await interaction.selectOptions(within(approval).getByRole("combobox"), "Artificial Intelligence");
    await interaction.click(within(approval).getByRole("checkbox", { name: /^Bandit theory/ }));
    expect(within(additional).queryByRole("checkbox", { name: /^Bandit theory/ })).toBeNull();
    await interaction.click(within(management).getByRole("button", { name: "Save access for Test Researcher" }));
    expect(portal.setAccess).toHaveBeenCalledWith("123", "Senior Approver", ["scientific-ai"], ["bandit-theory"]);
    await interaction.click(within(additional).getByRole("checkbox", { name: /^Scientific AI/ }));
    await interaction.click(within(management).getByRole("button", { name: "Save access for Test Researcher" }));
    expect(portal.setAccess).toHaveBeenLastCalledWith("123", "Senior Approver", [], ["bandit-theory"]);
  });

  it("preserves separate review grants when approval topics overlap or change", async () => {
    const interaction = userEvent.setup();
    portal.user = { ...reader, id: "owner", fullName: "Site Owner", role: "Admin" };
    portal.state.profiles = [portal.user, {
      ...reader, role: "Senior Approver", approvedTopics: ["bandit-theory"], assignedTopics: ["bandit-theory"],
    }];
    openAccess();
    const management = screen.getByRole("region", { name: "Manage researcher access" });
    const approval = within(management).getByRole("group", { name: "Assigned approval topics for Test Researcher" });
    const additional = within(management).getByRole("group", { name: "Additional review topics for Test Researcher (optional)" });
    await interaction.selectOptions(within(additional).getByRole("combobox"), "Astronomy");
    await interaction.click(within(additional).getByRole("checkbox", { name: /^Exoplanets/ }));
    await interaction.click(within(management).getByRole("button", { name: "Save access for Test Researcher" }));
    expect(portal.setAccess).toHaveBeenLastCalledWith("123", "Senior Approver", ["bandit-theory", "exoplanets"], ["bandit-theory"]);
    await interaction.click(within(approval).getByRole("button", { name: "Remove Bandit theory from assigned approval topics for test researcher" }));
    await interaction.selectOptions(within(approval).getByRole("combobox"), "Artificial Intelligence");
    await interaction.click(within(approval).getByRole("checkbox", { name: /^Scientific AI/ }));
    await interaction.selectOptions(within(additional).getByRole("combobox"), "Artificial Intelligence");
    expect((within(additional).getByRole("checkbox", { name: /^Bandit theory/ }) as HTMLInputElement).checked).toBe(true);
    await interaction.click(within(management).getByRole("button", { name: "Save access for Test Researcher" }));
    expect(portal.setAccess).toHaveBeenLastCalledWith("123", "Senior Approver", ["bandit-theory", "exoplanets"], ["scientific-ai"]);
  });

  it.each(["Senior Approver", "Admin"] as const)("shows inherited review access for %s on access and profile pages", async (role) => {
    const interaction = userEvent.setup();
    portal.user = { ...reader, role, approvedTopics: [], assignedTopics: ["bandit-theory"] };
    openAccess();
    const currentAccess = screen.getByRole("region", { name: "Your current access" });
    expect(within(currentAccess).getByText("Approved review topics:").parentElement?.textContent).toContain("Bandit theory");
    const application = screen.getByRole("region", { name: "Apply for reviewer access" });
    if (role === "Senior Approver") {
      await interaction.selectOptions(within(application).getByRole("combobox"), "Artificial Intelligence");
      expect(within(application).queryByRole("checkbox", { name: /^Bandit theory/ })).toBeNull();
      expect(within(application).getByRole("checkbox", { name: /^Scientific AI/ })).toBeTruthy();
    } else {
      expect(within(application).queryByRole("combobox")).toBeNull();
    }
    cleanup();
    render(<MemoryRouter><ProfilePage /></MemoryRouter>);
    const standing = screen.getByRole("region", { name: "Reviewer access" });
    const reviewDetails = within(standing).getByText("Approved review topics").parentElement;
    expect(reviewDetails?.textContent).toContain("Bandit theory");
    if (role === "Admin") expect(reviewDetails?.textContent).toContain("Exoplanets");
    else expect(reviewDetails?.textContent).not.toContain("Exoplanets");
  });
});
