import { useId, type ComponentProps } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

function safeUrl(value: string): string | undefined {
  if (!value || /[\u0000-\u0020\u007f\\]/.test(value)) return undefined;
  if (value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    if (url.username || url.password) return undefined;
    if (url.protocol === "mailto:") return value;
    if (/^https?:\/\//i.test(value) && ["http:", "https:"].includes(url.protocol)) return value;
  } catch {
    // Relative, malformed, and protocol-relative links are not navigation targets.
  }
  return undefined;
}

const mathOptions = {
  trust: false,
  // rehype-katex also catches parsing failures and retries with this setting.
  throwOnError: false,
  maxExpand: 1000,
  maxSize: 20,
  output: "htmlAndMathml",
} as const;

/** Render untrusted discussion text without HTML execution or remote image loads. */
export default function DiscussionMarkdown({ children }: { children: string }) {
  const prefix = `discussion-${useId()}-`;
  const footnoteLabel = `${prefix}footnote-label`;
  function Link({ children: content, href, title, id, "aria-label": label, "aria-describedby": description }: ComponentProps<"a">) {
      const destination = href && safeUrl(href);
      if (!destination) return <span>{content}</span>;
      const local = destination.startsWith("#");
      return (
        <a
          href={destination}
          title={title}
          id={id}
          aria-label={label}
          aria-describedby={description === "footnote-label" ? footnoteLabel : description}
          target={local || destination.startsWith("mailto:") ? undefined : "_blank"}
          rel="noopener noreferrer nofollow ugc"
          referrerPolicy="no-referrer"
          onClick={local ? (event) => {
            // HashRouter owns the URL fragment. In-page references must not change routes.
            event.preventDefault();
            try {
              const target = document.getElementById(decodeURIComponent(destination.slice(1)));
              target?.scrollIntoView({ block: "nearest" });
              if (target) {
                if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
                target.focus({ preventScroll: true });
              }
            } catch {
              // Invalid or missing anchors leave the current discovery open.
            }
          } : undefined}
        >{content}</a>
      );
  }
  const components: Components = {
    h1: "h4",
    h2: ({ children: content, id, className }) => (
      <h5 id={id === "footnote-label" ? footnoteLabel : id} className={className}>{content}</h5>
    ),
    h3: "h6",
    h4: "h6",
    h5: "h6",
    h6: "h6",
    table: ({ children: content }) => (
      <div className="markdown-table" role="region" aria-label="Table" tabIndex={0}>
        <table>{content}</table>
      </div>
    ),
    a: Link,
    // Loading an image could track readers. A link requires an explicit click.
    img: ({ src, alt, title }) => {
      const description = `[Image: ${alt?.trim() || title?.trim() || "no description provided"}]`;
      const destination = typeof src === "string" && /^https?:\/\//i.test(src) ? safeUrl(src) : undefined;
      return destination
        ? <Link href={destination} title={title}>{description}</Link>
        : <span className="discussion-image-description">{description}</span>;
    },
  };
  return (
    <Markdown
      skipHtml
      remarkPlugins={[remarkGfm, remarkMath]}
      remarkRehypeOptions={{ clobberPrefix: prefix }}
      rehypePlugins={[[rehypeKatex, mathOptions]]}
      urlTransform={(url, key) => key === "href" || key === "src" ? safeUrl(url) : undefined}
      components={components}
    >{children}</Markdown>
  );
}
