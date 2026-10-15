import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { CornerDownRight, MessageSquare, Send } from "lucide-react";
import { usePortal } from "../state/PortalContext";
import { canDiscuss } from "../services/permissions";
import { formatDate } from "./Ui";
import type { Discovery, DiscussionComment } from "../types";

const DiscussionMarkdown = lazy(() => import("./DiscussionMarkdown"));

function MarkdownBody({ children }: { children: string }) {
  return (
    <Suspense fallback={<div className="comment-plaintext">{children}</div>}>
      <DiscussionMarkdown>{children}</DiscussionMarkdown>
    </Suspense>
  );
}

function CommentForm({
  discovery,
  parent,
  onDone,
}: {
  discovery: Discovery;
  parent?: DiscussionComment;
  onDone?: () => void;
}) {
  const { addComment } = usePortal();
  const [body, setBody] = useState("");
  const [reference, setReference] = useState(parent?.reference ?? "");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState(false);
  const prefix = parent?.id ?? "new-comment";
  return (
    <form
      className="comment-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        setPending(true);
        setMessage("");
        setFailed(false);
        try {
          const result = await addComment({
            discoveryId: discovery.id,
            parentId: parent?.id ?? null,
            version: parent?.version ?? discovery.version,
            reference,
            body,
          });
          setMessage(result.message);
          setFailed(!result.ok);
          if (result.ok) {
            setBody("");
            setReference("");
            setPreview(false);
            onDone?.();
          }
        } catch {
          setFailed(true);
          setMessage("Posting could not be confirmed. Your draft is preserved; refresh the discussion before trying again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="split-row">
        <strong>
          {parent ? "Reply to this thread" : "Start an expert discussion"}
        </strong>
        <span className="tag">
          Manuscript {parent?.version ?? discovery.version}
        </span>
      </div>
      <label className="field" htmlFor={`${prefix}-reference`}>
        Reference <span className="muted">(optional)</span>
        <input
          id={`${prefix}-reference`}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          maxLength={250}
          placeholder="e.g. Assumption A1, Section 3, Theorem 1, Figure 2"
        />
      </label>
      <label className="field" htmlFor={`${prefix}-body`}>
        {parent ? "Your reply" : "Your comment"}
        <textarea
          id={`${prefix}-body`}
          required
          minLength={3}
          maxLength={6000}
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-describedby={`${prefix}-formatting`}
          placeholder="Ask a specific question, examine an assumption, or suggest a validation check."
        />
      </label>
      <div className="markdown-editor-tools">
        <details className="markdown-help">
          <summary id={`${prefix}-formatting`}>Markdown supported · Formatting help</summary>
          <ul className="markdown-help-examples">
            <li><code>**bold**</code> and <code>*italic*</code></li>
            <li><code>[link text](https://example.org)</code></li>
            <li><code>- item</code> for a list; <code>&gt; text</code> for a quote</li>
            <li><code>`code`</code> inline, or three backticks on separate lines for a code block</li>
            <li><code>$x^2$</code> inline math; <code>$$</code> on separate lines around an equation</li>
            <li>Tables and task lists are supported. Image Markdown appears as a link.</li>
          </ul>
        </details>
        <button className="text-button" type="button"
          aria-expanded={preview} aria-controls={`${prefix}-preview`}
          onClick={() => setPreview(!preview)}>
          {preview ? "Hide preview" : "Preview"}
        </button>
      </div>
      {preview && (
        <section className="markdown-preview" id={`${prefix}-preview`} aria-label="Comment preview">
          {body.trim() ? <div className="discussion-markdown"><MarkdownBody>{body}</MarkdownBody></div>
            : <p className="muted">Nothing to preview yet.</p>}
        </section>
      )}
      <div className="split-row">
        <small className="muted">
          Your comment and display name are visible to readers.
        </small>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          <Send size={15} />
          {pending ? "Posting…" : parent ? "Post reply" : "Post comment"}
        </button>
      </div>
      {message && (
        <p className={`notice ${failed ? "notice-error" : "notice-success"}`} role={failed ? "alert" : "status"}>
          {message}
        </p>
      )}
    </form>
  );
}
function CommentNode({
  comment,
  discovery,
  depth = 0,
}: {
  comment: DiscussionComment;
  discovery: Discovery;
  depth?: number;
}) {
  const { state, user } = usePortal();
  const [reply, setReply] = useState(false);
  const authorName =
    comment.authorName ||
    state.profiles.find((p) => p.id === comment.authorId)?.fullName ||
    "Researcher";
  const children = state.comments.filter((c) => c.parentId === comment.id);
  return (
    <article className={`discussion-comment ${depth ? "is-reply" : ""}`}>
      <div className="comment-meta">
        <span className="avatar avatar-small">
          {authorName
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("") ?? "?"}
        </span>
        <strong>{authorName}</strong>
        <span>{formatDate(comment.createdAt)}</span>
        <span className="tag">{comment.version}</span>
      </div>
      {comment.reference && (
        <span className="reference-tag">
          <CornerDownRight size={13} />
          {comment.reference}
        </span>
      )}
      <div className="comment-body discussion-markdown"><MarkdownBody>{comment.body}</MarkdownBody></div>
      {canDiscuss(user, discovery) && (
        <button
          className="text-button"
          onClick={() => setReply(!reply)}
          aria-expanded={reply}
        >
          {reply ? "Cancel reply" : "Reply to thread"}
        </button>
      )}
      {reply && (
        <CommentForm
          discovery={discovery}
          parent={comment}
          onDone={() => setReply(false)}
        />
      )}
      <div className={depth < 3 ? "thread-children" : "thread-children flat"}>
        {children.map((c) => (
          <CommentNode
            key={c.id}
            comment={c}
            discovery={discovery}
            depth={depth + 1}
          />
        ))}
      </div>
    </article>
  );
}
export default function Discussion({ discovery }: { discovery: Discovery }) {
  const { state, user, configured, loading, error } = usePortal();
  const [version, setVersion] = useState("all");
  const comments = state.comments.filter((c) => c.discoveryId === discovery.id);
  const versions = Array.from(
    new Set([discovery.version, ...comments.map((c) => c.version)]),
  );
  const visible = comments.filter(
    (c) => version === "all" || c.version === version,
  );
  return (
    <section className="discussion-section" id="discussion">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Expert perspectives</span>
          <h2>
            Research discussion{" "}
            <span className="count-pill">{visible.length}</span>
          </h2>
        </div>
        <MessageSquare size={24} />
      </div>
      <p className="muted">
        Cite a theorem, assumption, section, or figure. Threads retain their
        manuscript version.
      </p>
      <label className="version-filter">
        Show discussions for{" "}
        <select value={version} onChange={(e) => setVersion(e.target.value)}>
          <option value="all">All manuscript versions</option>
          {versions.map((v) => (
            <option value={v} key={v}>
              {v}
              {v === discovery.version ? " · current" : ""}
            </option>
          ))}
        </select>
      </label>
      {visible
        .filter((c) => !c.parentId)
        .map((c) => (
          <CommentNode key={c.id} comment={c} discovery={discovery} />
        ))}
      {!configured ? (
        <p className="notice">
          Research discussions are unavailable until account services are
          connected.
        </p>
      ) : loading ? (
        <p role="status">Loading discussion…</p>
      ) : error ? (
        <p className="notice notice-error">
          Discussion could not be refreshed. Displayed comments may be
          incomplete. Resolve the connection error above and try again.
        </p>
      ) : null}
      {configured && !loading && !error && !visible.length && (
        <div className="empty-discussion">
          <MessageSquare size={22} />
          <p>No discussion for this version yet.</p>
        </div>
      )}
      {canDiscuss(user, discovery) ? (
        <CommentForm discovery={discovery} />
      ) : (
        <div className="notice discussion-gate">
          <strong>Reviewer access required to post</strong>
          <p>
            Posting and replies require approval for this discovery’s topic.
          </p>
          <Link className="btn btn-secondary" to={user ? "/access" : "/login"}>
            {user
              ? "Request topic-specific access"
              : "Sign in to request reviewer access"}{" "}
            <CornerDownRight size={15} />
          </Link>
        </div>
      )}
    </section>
  );
}
