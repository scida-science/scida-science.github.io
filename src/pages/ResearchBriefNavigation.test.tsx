// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HashRouter, MemoryRouter, Route, Routes } from "react-router-dom";
import DiscoveryPage from "./DiscoveryPage";
import HomePage from "./HomePage";
import { discoveries } from "../../test/fixtures/discoveries";
import type { Discovery } from "../types";
import type { usePortal } from "../state/PortalContext";

let portal: ReturnType<typeof usePortal>;
let discovery: Discovery;
let mobile = false;
let reducedMotion = false;
vi.mock("../state/PortalContext", () => ({ usePortal: () => portal }));

beforeEach(() => {
  mobile = false;
  reducedMotion = false;
  discovery = {
    ...structuredClone(discoveries[0]), id: "UI-RESEARCH", title: "Long research brief for interface verification",
    headlineResult: {
      equation: String.raw`\begin{aligned}A_n&=\frac{1}{n}\sum_{i=1}^n x_i\\B_n&\leq\sqrt{n}\end{aligned}`,
      caption: "The complete explanation remains attached to the result, including its assumptions and limitations.",
    },
    sections: Array.from({ length: 13 }, (_, index) => ({
      id: `part-${index + 1}`, title: `Research section ${index + 1}`,
      body: `First paragraph for section ${index + 1}.\n\nA **separate** paragraph with a [reference](https://example.org/reference).`,
      ...(index === 0 ? { equation: String.raw`\sigma^2=\frac{1}{n}\sum_{i=1}^{n}(x_i-\mu)^2` } : {}),
    })),
  };
  const success = () => vi.fn().mockResolvedValue({ ok: true, message: "Saved." });
  portal = {
    state: { discoveries: [discovery], profiles: [], comments: [], codeRequests: [], applications: [], invitations: [] },
    user: null, configured: true, loading: false, error: null,
    signInWithGitHub: success(), signOut: success(), refresh: success(), setFollowing: success(), saveProfile: success(),
    applyForReview: success(), reviewApplication: success(), createInvitation: success(), previewInvitation: success(),
    confirmInvitation: success(), addComment: success(), requestCode: success(), updateDiscovery: success(), setAccess: success(),
    downloadMaterial: success(), downloadPackageFile: success(), loadFigure: vi.fn(),
  };
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query === "(max-width: 800px)" ? mobile : query === "(prefers-reduced-motion: reduce)" && reducedMotion,
  })));
  vi.spyOn(HTMLElement.prototype, "focus");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });
const route = <Routes><Route path="/discoveries/:id" element={<DiscoveryPage />} /></Routes>;
const show = () => render(<MemoryRouter initialEntries={[`/discoveries/${discovery.id}`]}>{route}</MemoryRouter>);

describe("Long research briefs", () => {
  it("shows the complete headline result and caption alongside all thirteen sections", async () => {
    show();
    const result = await screen.findByRole("region", { name: "Headline result equation" });
    expect(result.tabIndex).toBe(0);
    expect(result.querySelector("math")).not.toBeNull();
    expect(result.querySelector("annotation")?.textContent).toBe(discovery.headlineResult!.equation);
    expect(screen.getByText(discovery.headlineResult!.caption).tagName).toBe("FIGCAPTION");
    for (const section of discovery.sections) expect(screen.getByRole("heading", { name: section.title })).toBeTruthy();
    const sectionResult = await screen.findByRole("region", { name: "Research section 1: mathematical result" });
    expect(sectionResult.tabIndex).toBe(0);
    expect(sectionResult.querySelector("annotation")?.textContent).toBe(discovery.sections[0].equation);
    await waitFor(() => expect(screen.getAllByRole("link", { name: "reference" })).toHaveLength(13));
    const nav = screen.getByRole("navigation", { name: "On this page" });
    expect(within(nav).getAllByRole("button", { name: /Research section/ })).toHaveLength(13);
    expect(within(nav).getByRole("button", { name: "Headline result" })).toBeTruthy();
  });

  it("offers collapsed mobile contents and moves keyboard focus without changing the hash route", async () => {
    mobile = true;
    reducedMotion = true;
    window.history.replaceState(null, "", `/#/discoveries/${discovery.id}`);
    render(<HashRouter>{route}</HashRouter>);
    const nav = screen.getByRole("navigation", { name: "On this page" });
    const disclosure = nav.querySelector("details")!;
    expect(disclosure.open).toBe(false);
    expect(within(nav).queryByRole("button", { name: /Research section 13/ })).toBeNull();
    const interaction = userEvent.setup();
    const summary = nav.querySelector("summary")!;
    await interaction.click(summary);
    await waitFor(() => expect(disclosure.open).toBe(true));
    within(nav).getByRole("button", { name: /Research section 13/ }).focus();
    await interaction.keyboard("{Enter}");
    const destination = document.getElementById("section-part-13")!;
    expect(document.activeElement).toBe(destination);
    expect(destination.scrollIntoView).toHaveBeenLastCalledWith({ behavior: "auto" });
    expect(window.location.hash).toBe(`#/discoveries/${discovery.id}`);
    await interaction.click(within(nav).getByRole("button", { name: /Research discussion/ }));
    expect(document.activeElement).toBe(document.getElementById("discussion"));
    expect(window.location.hash).toBe(`#/discoveries/${discovery.id}`);
  });

  it("retains archived astronomy notices and history without inventing a headline result", async () => {
    discovery = {
      ...structuredClone(discoveries.find((item) => item.field === "Astronomy")!),
      status: "Withdrawn", statusHistory: [{
        from: "Awaiting Validation", to: "Withdrawn", reason: "The record is retained for a repeat review.",
        decidedAt: "2026-10-15T00:00:00Z", decidedBy: "123", decidedByName: "Test owner", version: "v0.1",
      }],
    };
    portal.state.discoveries = [discovery];
    show();
    expect(screen.getByRole("heading", { level: 1, name: discovery.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Archive" }).getAttribute("href")).toBe("/archive");
    expect(screen.getByText("Archived investigation")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Headline result" })).toBeNull();
    const nav = screen.getByRole("navigation", { name: "On this page" });
    await userEvent.setup().click(within(nav).getByRole("button", { name: "Status history" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Status history" }));
    expect(within(nav).getAllByRole("button")).toHaveLength(discovery.sections.length + 2);
  });

  it("keeps feed headlines inside stable discovery links without an extra nested tab stop", async () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    const result = await screen.findByRole("region", { name: "Mathematical result" });
    expect(result.getAttribute("tabindex")).toBeNull();
    expect(result.closest("a")?.getAttribute("href")).toBe(`/discoveries/${discovery.id}`);
    expect(screen.getByText(discovery.headlineResult!.caption)).toBeTruthy();
  });
});
