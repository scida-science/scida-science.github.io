// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Discussion from "./Discussion";
import { discoveries } from "../../test/fixtures/discoveries";
import type { usePortal } from "../state/PortalContext";
import type { ActionResult } from "../types";
import { emptyPortalState } from "../services/repository";

let portal: Pick<ReturnType<typeof usePortal>, "state" | "user" | "addComment" | "configured" | "loading" | "error">;
vi.mock("../state/PortalContext", () => ({ usePortal: () => portal }));
beforeEach(() => {
  portal = {
    state: emptyPortalState(), configured: true, loading: false, error: null,
    user: { id: "test-owner", fullName: "Owner", email: "test@example.invalid", affiliation: "", researchRole: "", scholarUrl: "", website: "", fields: [], expertiseTopics: [], expertiseStatement: "", evidence: "", role: "Admin", approvedTopics: [], assignedTopics: [] },
    addComment: vi.fn().mockResolvedValue({ ok: true, message: "Discussion contribution saved." }),
  };
});
afterEach(cleanup);
const open = () => render(<MemoryRouter><Discussion discovery={discoveries[0]} /></MemoryRouter>);

describe("Discussion submission recovery", () => {
  it("preserves a rejected draft and explains the failure as an alert", async () => {
    vi.mocked(portal.addComment).mockResolvedValue({ ok: false, message: "Reviewer access has changed." });
    open();
    const interaction = userEvent.setup();
    await interaction.type(screen.getByLabelText("Your comment"), "Please inspect this assumption.");
    await interaction.click(screen.getByRole("button", { name: "Post comment" }));
    expect(screen.getByRole("alert").textContent).toBe("Reviewer access has changed.");
    expect((screen.getByLabelText("Your comment") as HTMLTextAreaElement).value).toBe("Please inspect this assumption.");
    expect((screen.getByRole("button", { name: "Post comment" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("recovers from an unexpected error without discarding the draft or leaving Posting stuck", async () => {
    vi.mocked(portal.addComment).mockRejectedValue(new Error("Connection failed"));
    open();
    const interaction = userEvent.setup();
    await interaction.type(screen.getByLabelText("Your comment"), "Please inspect this assumption.");
    await interaction.type(screen.getByLabelText(/Reference/), "Section 2");
    await interaction.click(screen.getByRole("button", { name: "Post comment" }));
    expect(screen.getByRole("alert").textContent).toContain("Your draft is preserved");
    expect((screen.getByLabelText("Your comment") as HTMLTextAreaElement).value).toBe("Please inspect this assumption.");
    expect((screen.getByLabelText(/Reference/) as HTMLInputElement).value).toBe("Section 2");
    expect((screen.getByRole("button", { name: "Post comment" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables repeated submission until the original write completes", async () => {
    let finish!: (result: ActionResult) => void;
    vi.mocked(portal.addComment).mockImplementation(() => new Promise<ActionResult>((resolve) => { finish = resolve; }));
    open();
    const interaction = userEvent.setup();
    await interaction.type(screen.getByLabelText("Your comment"), "Please inspect this assumption.");
    await interaction.click(screen.getByRole("button", { name: "Post comment" }));
    await interaction.click(screen.getByRole("button", { name: "Posting…" }));
    expect(portal.addComment).toHaveBeenCalledOnce();
    await act(async () => finish({ ok: true, message: "Discussion contribution saved." }));
    expect(screen.getByRole("status").textContent).toBe("Discussion contribution saved.");
    expect((screen.getByLabelText("Your comment") as HTMLTextAreaElement).value).toBe("");
  });
});
