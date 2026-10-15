// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DiscussionMarkdown from "./DiscussionMarkdown";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const show = (body: string) => render(<DiscussionMarkdown>{body}</DiscussionMarkdown>);

describe("Discussion Markdown", () => {
  it("renders readable headings, emphasis, quotations, lists, and literal code", () => {
    const { container } = show(`# Evidence\n\n**Strong** and *emphasis* with ~~withdrawn~~ text.\n\n> Quoted evidence\n\n1. First check\n2. Second check\n\n- One dataset\n- Another dataset\n\nUse \`x < y\`.\n\n\`\`\`python\nprint('<script>literal</script>')\n\`\`\``);
    expect(screen.getByRole("heading", { level: 4, name: "Evidence" })).toBeTruthy();
    expect(container.querySelector("h1, h2, h3")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("Strong");
    expect(container.querySelector("em")?.textContent).toBe("emphasis");
    expect(container.querySelector("del")?.textContent).toBe("withdrawn");
    expect(container.querySelector("blockquote")?.textContent).toContain("Quoted evidence");
    expect(container.querySelectorAll("li")).toHaveLength(4);
    expect(container.querySelector("pre code")?.textContent).toContain("<script>literal</script>");
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders GFM tables and non-editable task lists", () => {
    show("| Check | Result |\n| --- | --- |\n| Residual | Pending |\n\n- [x] Read paper\n- [ ] Reproduce analysis");
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((node) => node.textContent)).toEqual(["Check", "Result"]);
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes.map((box) => box.checked)).toEqual([true, false]);
    expect(checkboxes.every((box) => box.disabled)).toBe(true);
  });

  it("renders inline and display equations with accessible MathML", () => {
    const { container } = show(String.raw`The uncertainty is $\sigma^2$.

$$
\Delta t = \frac{P}{2}
$$`);
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.querySelectorAll("math")).toHaveLength(2);
    expect(container.querySelector(".katex-display math")?.getAttribute("display")).toBe("block");
    expect(container.querySelector("annotation")?.textContent).toBe(String.raw`\sigma^2`);
  });

  it("leaves malformed and recursive math readable without crashing", () => {
    const { container } = show(String.raw`Bad input $\frac{1}{$.

Loop $\def\a{\a}\a$.`);
    expect(container.querySelectorAll(".katex-error")).toHaveLength(2);
    expect(container.textContent).toContain(String.raw`\frac{1}{`);
    expect(container.textContent).toContain(String.raw`\def\a{\a}\a`);
  });

  it("does not create raw HTML, executable content, frames, or form controls", () => {
    const { container } = show(`<script>alert('unsafe')</script>\n\n<img src="https://tracker.invalid/pixel" onerror="alert(1)">\n\n<iframe src="https://tracker.invalid"></iframe>\n\n<input value="forged">\n\n<span onclick="alert(1)">Ordinary text</span>`);
    expect(container.querySelector("script, img, iframe, input, [onclick], [onerror]")).toBeNull();
    expect(container.textContent).toContain("Ordinary text");
  });

  it("allows explicit web/email links and strips unsafe or ambiguous destinations", () => {
    show(`[Paper](https://example.org/paper) [HTTP](http://example.org/data) [Email](mailto:research@example.org)

[Script](javascript:alert%281%29) [Mixed](JaVaScRiPt:alert%281%29) [Entity](jav&#x61;script:alert%281%29) [Data](data:text/html,unsafe) [Protocol relative](//tracker.invalid) [Relative](/private) [Credentials](https://user:password@example.org) [File](file:///private.txt)`);
    const links = screen.getAllByRole("link");
    expect(links.map((node) => node.getAttribute("href"))).toEqual(["https://example.org/paper", "http://example.org/data", "mailto:research@example.org"]);
    expect(screen.getByRole("link", { name: "Paper" }).getAttribute("rel")).toContain("noopener noreferrer");
    expect(screen.getByRole("link", { name: "Paper" }).getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(screen.getByText("Script").tagName).toBe("SPAN");
  });

  it("offers explicit safe image links without loading remote, data, or relative images", () => {
    const { container } = show('![Residual plot](https://tracker.invalid/pixel.png) ![Embedded](data:image/png;base64,AAAA) ![Local](figure.png) ![](https://tracker.invalid/empty.png) ![](http://example.org/figure.png "Figure title") ![Email](mailto:research@example.org) ![Unsafe](javascript:alert%281%29)');
    expect(container.querySelector("img, source, picture")).toBeNull();
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["https://tracker.invalid/pixel.png", "https://tracker.invalid/empty.png", "http://example.org/figure.png"]);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow ugc");
      expect(link.getAttribute("referrerpolicy")).toBe("no-referrer");
    }
    expect(container.textContent).toContain("[Image: Residual plot]");
    expect(container.textContent).toContain("[Image: no description provided]");
    expect(screen.getByRole("link", { name: "[Image: Figure title]" })).toBeTruthy();
    expect(screen.getByText("[Image: Unsafe]").tagName).toBe("SPAN");
    expect(screen.getByText("[Image: Email]").tagName).toBe("SPAN");
    expect(container.querySelector("link[rel=preload]")).toBeNull();
  });

  it("blocks math commands that could insert images, links, or arbitrary HTML", () => {
    const { container } = show(String.raw`$\includegraphics{https://tracker.invalid/pixel.png}$

$\href{javascript:alert(1)}{unsafe}$

$\htmlClass{attacker-controlled}{x}$`);
    expect(container.querySelector("img, a, .attacker-controlled")).toBeNull();
    expect(container.querySelectorAll("math").length).toBeGreaterThan(0);
  });

  it("keeps footnotes unique across comments and scrolls without changing the app route", () => {
    const body = "Evidence[^source].\n\n[^source]: Supporting explanation.";
    const { container } = render(<><DiscussionMarkdown>{body}</DiscussionMarkdown><DiscussionMarkdown>{body}</DiscussionMarkdown></>);
    const ids = [...container.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    const references = screen.getAllByRole("link", { name: "1" });
    expect(references[0].getAttribute("href")).not.toBe(references[1].getAttribute("href"));
    const target = document.getElementById(references[0].getAttribute("href")!.slice(1))!;
    target.scrollIntoView = vi.fn();
    const before = window.location.hash;
    fireEvent.click(references[0]);
    expect(target.scrollIntoView).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(target);
    expect(window.location.hash).toBe(before);
    expect(document.getElementById(references[0].getAttribute("aria-describedby")!)).toBeTruthy();
  });
});
