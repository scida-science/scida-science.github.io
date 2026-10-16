// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Discussion from "./Discussion";
import { discoveries } from "../../test/fixtures/discoveries";
import type { usePortal } from "../state/PortalContext";
import type { ActionResult, DiscussionComment } from "../types";
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
const comment = (changes: Partial<DiscussionComment> = {}): DiscussionComment => ({
  id: "thread-1", discoveryId: discoveries[0].id, authorId: "test-owner", authorName: "Owner",
  version: discoveries[0].version, parentId: null, reference: "Section 2",
  body: "**Existing result** with `analysis.py`.", createdAt: "2026-10-15T12:00:00Z", ...changes,
});

describe("Markdown discussions", () => {
  it("previews Markdown without changing the draft or submitting, then posts the original source", async () => {
    open();
    const interaction = userEvent.setup();
    const body = "**Check this**\n\n- First assumption\n- Second assumption\n\n[Paper](https://example.org/paper)\n\n```python\nprint(1 < 2)\n```";
    const textarea = screen.getByLabelText("Your comment") as HTMLTextAreaElement;
    await interaction.click(textarea);
    await interaction.paste(body);
    await interaction.click(screen.getByRole("button", { name: "Preview" }));
    const preview = screen.getByRole("region", { name: "Comment preview" });
    expect((await within(preview).findByText("Check this")).tagName).toBe("STRONG");
    expect(within(preview).getAllByRole("listitem")).toHaveLength(2);
    expect(within(preview).getByRole("link", { name: "Paper" }).getAttribute("href")).toBe("https://example.org/paper");
    expect(textarea.value).toBe(body);
    expect(portal.addComment).not.toHaveBeenCalled();
    await interaction.click(screen.getByRole("button", { name: "Hide preview" }));
    expect(screen.queryByRole("region", { name: "Comment preview" })).toBeNull();
    expect(textarea.value).toBe(body);
    await interaction.click(screen.getByRole("button", { name: "Post comment" }));
    expect(portal.addComment).toHaveBeenCalledWith({
      discoveryId: discoveries[0].id, parentId: null, version: discoveries[0].version, reference: "", body,
    });
    expect(textarea.value).toBe("");
  });

  it("renders saved roots and replies with the same formatting used in preview", async () => {
    portal.state.comments = [comment(), comment({ id: "reply-1", parentId: "thread-1", body: "A *follow-up* with $x^2$." })];
    const { container } = open();
    expect((await screen.findByText("Existing result")).tagName).toBe("STRONG");
    expect(screen.getByText("analysis.py").tagName).toBe("CODE");
    expect((await screen.findByText("follow-up")).tagName).toBe("EM");
    expect(container.querySelector(".is-reply .katex")).toBeTruthy();
    expect(screen.getAllByText("Section 2")).toHaveLength(2);
  });

  it("previews a reply and preserves its parent and manuscript version when posting", async () => {
    portal.state.comments = [comment({ version: "v0.1" })];
    open();
    const interaction = userEvent.setup();
    await interaction.click(screen.getByRole("button", { name: "Reply to thread" }));
    const reply = screen.getByLabelText("Your reply") as HTMLTextAreaElement;
    const form = reply.closest("form")!;
    await interaction.click(reply);
    await interaction.paste("A **specific** validation check.");
    await interaction.click(within(form).getByRole("button", { name: "Preview" }));
    const preview = within(form).getByRole("region", { name: "Comment preview" });
    expect((await within(preview).findByText("specific")).tagName).toBe("STRONG");
    await interaction.click(within(form).getByRole("button", { name: "Post reply" }));
    expect(portal.addComment).toHaveBeenCalledWith({
      discoveryId: discoveries[0].id, parentId: "thread-1", version: "v0.1", reference: "Section 2",
      body: "A **specific** validation check.",
    });
    expect(screen.queryByLabelText("Your reply")).toBeNull();
  });

  it("keeps a failed Markdown draft and its preview available for correction", async () => {
    vi.mocked(portal.addComment).mockResolvedValue({ ok: false, message: "The write could not be saved." });
    open();
    const interaction = userEvent.setup();
    await interaction.click(screen.getByLabelText("Your comment"));
    await interaction.paste("**Important** check.");
    await interaction.click(screen.getByRole("button", { name: "Preview" }));
    await interaction.click(screen.getByRole("button", { name: "Post comment" }));
    expect(screen.getByRole("alert").textContent).toContain("could not be saved");
    expect((screen.getByLabelText("Your comment") as HTMLTextAreaElement).value).toBe("**Important** check.");
    expect((await within(screen.getByRole("region", { name: "Comment preview" })).findByText("Important")).tagName).toBe("STRONG");
  });
});

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

describe("Notification discussion links", () => {
  it("waits for comments, selects the actual older manuscript version, and focuses a reply once", async () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    portal.loading = true;
    const view = () => <MemoryRouter initialEntries={["/discoveries/AST-001?comment=old-reply&version=incorrect"]}><Discussion discovery={discoveries[0]} /><button>Continue reading</button></MemoryRouter>;
    const { rerender } = render(view());
    expect(screen.queryByText(/linked discussion contribution could not be found/)).toBeNull();
    portal = { ...portal, loading: false, state: { ...portal.state, comments: [
      comment({ id: "old-root", version: "v0.1" }),
      comment({ id: "old-reply", parentId: "old-root", version: "v0.1", body: "An earlier reply." }),
      comment({ id: "current-root", body: "Current discussion." }),
    ] } };
    rerender(view());
    const target = document.getElementById("comment-old-reply");
    await waitFor(() => expect(document.activeElement).toBe(target));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("v0.1");
    expect(screen.queryByText("Current discussion.")).toBeNull();
    expect(scroll).toHaveBeenCalledOnce();
    const elsewhere = screen.getByRole("button", { name: "Continue reading" });
    elsewhere.focus();
    portal = { ...portal, state: { ...portal.state, comments: [...portal.state.comments] } };
    rerender(view());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(document.activeElement).toBe(elsewhere);
    expect(scroll).toHaveBeenCalledOnce();
  });

  it("explains an unavailable link while preserving the discussion", () => {
    portal.state.comments = [comment()];
    render(<MemoryRouter initialEntries={["/discoveries/AST-001?comment=missing"]}><Discussion discovery={discoveries[0]} /></MemoryRouter>);
    expect(screen.getByRole("status").textContent).toContain("The linked discussion contribution could not be found");
    expect(screen.getByRole("article", { name: "Discussion contribution by Owner" })).toBeTruthy();
  });
});
