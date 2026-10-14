// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AccessPage from "./AccessPage";
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
    signInWithGitHub: success(), downloadMaterial: success(), signOut: success(),
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
});
