import { lazy, Suspense, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  BookOpen,
  Code2,
  Database,
  FileText,
  Image,
  Pencil,
  Telescope,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { usePortal } from "../state/PortalContext";
import { topics } from "../data/topics";
import { archiveDescriptions, isArchived } from "../data/discoveryStages";
import { StatusBadge, formatDate } from "../components/Ui";
import Discussion from "../components/Discussion";
import DiscoveryEditor from "../components/DiscoveryEditor";
import EvidenceFigure from "../components/EvidenceFigure";
import FollowDiscovery from "../components/FollowDiscovery";
import ReviewerPackage from "../components/ReviewerPackage";
import type { ActionResult, Discovery } from "../types";

const Equation = lazy(() => import("../components/Equation"));
const ResearchMarkdown = lazy(() => import("../components/DiscussionMarkdown"));

const materialNames: Array<{
  key: keyof Discovery["materials"];
  label: string;
  icon: typeof FileText;
}> = [
  { key: "paper", label: "Full paper", icon: FileText },
  { key: "appendix", label: "Appendix", icon: BookOpen },
  { key: "figures", label: "Figures", icon: Image },
  { key: "data", label: "Data", icon: Database },
  { key: "repository", label: "Analysis package", icon: Code2 },
];
function Materials({ discovery }: { discovery: Discovery }) {
  const { state, user, requestCode, downloadMaterial, configured, error } =
    usePortal();
  const [open, setOpen] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [requestResult, setRequestResult] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const [downloading, setDownloading] = useState<
    keyof Discovery["materials"] | null
  >(null);
  const [downloadResult, setDownloadResult] = useState<ActionResult | null>(
    null,
  );
  const [packageKind, setPackageKind] = useState<keyof Discovery["materials"]>("repository");
  const requests = state.codeRequests.filter(
    (r) => r.discoveryId === discovery.id && r.userId === user?.id,
  );
  const hasPackageAccess = Boolean(discovery.materials.repository);
  const hasPackage = hasPackageAccess || Boolean(discovery.restrictedMaterials?.includes("repository"));
  return (
    <>
      <section className="materials-panel panel">
        <span className="eyebrow">Inspect the evidence</span>
        <h2>Supporting materials</h2>
        {!materialNames.some(({ key }) => discovery.materials[key] || discovery.restrictedMaterials?.includes(key)) &&
          <p className="muted">No supporting materials available.</p>}
        {materialNames.filter(({ key }) => discovery.materials[key] || discovery.restrictedMaterials?.includes(key)).map(({ key, label, icon: Icon }) => (
          <div className="material-row" key={key}>
            <Icon size={18} />
            <div>
              <strong>{label}</strong>
              {key === "repository" && <span>Code, data, and reproduction instructions.</span>}
              {discovery.materials[key] ? (
                configured ? (
                  <button
                    type="button"
                    className="text-button material-download"
                    disabled={downloading !== null}
                    onClick={async () => {
                      setDownloading(key);
                      setPackageKind(key);
                      setDownloadResult(null);
                      try {
                        setDownloadResult(
                          await downloadMaterial(discovery.id, key),
                        );
                      } catch {
                        setDownloadResult({
                          ok: false,
                          message:
                            "The material could not be downloaded. Please try again.",
                        });
                      } finally {
                        setDownloading(null);
                      }
                    }}
                  >
                    <Download size={13} />
                    {downloading === key
                      ? "Opening…"
                      : key === "repository"
                        ? "Open analysis package"
                        : `Open ${label.toLowerCase()}`}
                  </button>
                ) : (
                  <span>
                    Materials unavailable until account services are connected
                  </span>
                )
              ) : discovery.restrictedMaterials?.includes(key) ? (
                <>
                  <span>{key === "repository" ? "Approval required" : "Restricted material"}</span>
                  {key !== "repository" && <Link
                    to={user ? "/access" : "/login"}
                    aria-label={`${user ? "Request access to" : "Sign in to access"} ${label.toLowerCase()}`}
                  >
                    {user
                      ? "Request topic-specific access"
                      : "Sign in to inspect access"}
                  </Link>}
                </>
              ) : (
                <span>Not uploaded yet</span>
              )}
              {key === "repository" && configured && hasPackageAccess && <span>
                {user ? "Your account has access." : "Available to download."}
              </span>}
            </div>
          </div>
        ))}
        {downloadResult && (
          <p
            role={downloadResult.ok ? "status" : "alert"}
            className={`notice ${downloadResult.ok ? "notice-success" : "notice-error"}`}
          >
            {downloadResult.message}
          </p>
        )}
        {downloadResult?.package && <ReviewerPackage key={`${discovery.id}-${packageKind}`}
          discoveryId={discovery.id} kind={packageKind} bundle={downloadResult.package} />}
        {hasPackage && !hasPackageAccess && (user && configured ? (
          <button
            className="btn btn-secondary request-code-button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            disabled={pending}
          >
            <Code2 size={16} />
            {open ? "Close request form" : "Request code access"}
          </button>
        ) : (
          <p className="muted">
            {configured ? (
              <Link to="/login">Sign in to request code access</Link>
            ) : (
              "Code requests are unavailable until account services are connected."
            )}
          </p>
        ))}
        {open && hasPackage && user && configured && !hasPackageAccess && (
          <form
            className="stack request-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (pending) return;
              setPending(true);
              setRequestResult(null);
              try {
                const result = await requestCode(discovery.id, explanation);
                setRequestResult(result);
                if (result.ok) setExplanation("");
              } catch {
                setRequestResult({ ok: false, message: "The code request could not be submitted. Please try again." });
              } finally {
                setPending(false);
              }
            }}
          >
            <label className="field">
              Why would you like access?
              <textarea
                value={explanation}
                required
                maxLength={2000}
                onChange={(e) => setExplanation(e.target.value)}
                rows={3}
                placeholder="Briefly describe your proposed review or reproduction."
              />
            </label>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={pending}
            >
              {pending ? "Submitting…" : "Submit code request"}
            </button>
            <small className="muted">
              Your request is shared with the administrator. Submitting does not
              automatically grant access to the analysis package.
            </small>
            {requestResult && (
              <p className={`notice ${requestResult.ok ? "notice-success" : "notice-error"}`}
                role={requestResult.ok ? "status" : "alert"}>
                {requestResult.message}
              </p>
            )}
          </form>
        )}
        {error && user && (
          <p className="notice notice-error">
            Your request history may be unavailable. Resolve the connection
            error above to refresh it.
          </p>
        )}
        {requests.length > 0 && (
          <details className="request-history">
            <summary>Your code requests ({requests.length})</summary>
            {requests.map((r) => (
              <p key={r.id}>
                <small>{formatDate(r.createdAt)}</small>
                <br />
                {r.explanation}
              </p>
            ))}
          </details>
        )}
      </section>
    </>
  );
}
function ResearchBrief({ discovery }: { discovery: Discovery }) {
  return (
    <div className="research-brief">
      {discovery.sections.map((s, i) => (
        <section
          key={s.id}
          id={`section-${s.id}`}
          className="brief-section"
          tabIndex={-1}
        >
          <span className="section-number">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div>
            <h2>{s.title}</h2>
            <div className="research-markdown discussion-markdown">
              <Suspense fallback={<p>{s.body}</p>}>
                <ResearchMarkdown>{s.body}</ResearchMarkdown>
              </Suspense>
            </div>
            {discovery.figures?.filter((f) => f.sectionId === s.id).map((f) => (
              <EvidenceFigure key={f.id} discoveryId={discovery.id} figure={f} revision={discovery.revision ?? discovery.updatedAt} expandable />
            ))}
            {s.equation && (
              <Suspense
                fallback={
                  <div className="equation">
                    <code>{s.equation}</code>
                  </div>
                }
              >
                <Equation expression={s.equation} focusable label={`${s.title}: mathematical result`} />
              </Suspense>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
function ContentsNavigation({ discovery }: { discovery: Discovery }) {
  const [open, setOpen] = useState(() =>
    typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 800px)").matches,
  );
  function jumpTo(id: string) {
    const element = document.getElementById(id);
    if (!element) return;
    element.scrollIntoView({
      behavior: typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto" : "smooth",
    });
    if (!element.hasAttribute("tabindex")) element.tabIndex = -1;
    element.focus({ preventScroll: true });
  }
  return (
    <nav className="contents-panel" aria-label="On this page">
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <span>In this brief <small>{discovery.sections.length} sections</small></span>
          <ChevronDown size={17} aria-hidden="true" />
        </summary>
        <div className="contents-links" hidden={!open}>
          {discovery.headlineResult && <button className="contents-extra" type="button" onClick={() => jumpTo("headline-result")}>
            Headline result
          </button>}
          {discovery.sections.map((section, index) => <button key={section.id} type="button" onClick={() => jumpTo(`section-${section.id}`)}>
            <span>{String(index + 1).padStart(2, "0")}</span>{section.title}
          </button>)}
          {!!discovery.statusHistory?.length && <button className="contents-extra" type="button" onClick={() => jumpTo("status-history-heading")}>
            Status history
          </button>}
          <button className="contents-extra" type="button" onClick={() => jumpTo("discussion")}>
            Research discussion ↓
          </button>
        </div>
      </details>
    </nav>
  );
}
function statusDecisions(discovery: Discovery) {
  return [...(discovery.statusHistory ?? [])].reverse()
    .sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt));
}
function ArchiveNotice({ discovery }: { discovery: Discovery }) {
  if (!isArchived(discovery.status)) return null;
  const latest = statusDecisions(discovery)[0];
  return (
    <section className="archive-notice" aria-labelledby="archive-outcome">
      <span className="eyebrow">Archived investigation</span>
      <h2 id="archive-outcome">{discovery.status}</h2>
      <p>{archiveDescriptions[discovery.status]}</p>
      {latest?.to === discovery.status ? <>
        <p className="decision-reason">{latest.reason}</p>
        <p className="muted">
          <time dateTime={latest.decidedAt}>{formatDate(latest.decidedAt)}</time>
          {" · "}{latest.decidedByName}{" · "}{latest.version}
        </p>
      </> : <p className="muted">No status-change explanation has been recorded.</p>}
    </section>
  );
}
function StatusHistory({ discovery }: { discovery: Discovery }) {
  const decisions = statusDecisions(discovery);
  if (!decisions.length) return null;
  return (
    <section className="decision-history" aria-labelledby="status-history-heading">
      <h2 id="status-history-heading">Status history</h2>
      <ol aria-label="Status decisions, newest first">
        {decisions.map((decision, index) => (
          <li key={`${decision.decidedAt}-${index}`}>
            <h3>{decision.from}{" → "}{decision.to}</h3>
            <p className="decision-reason">{decision.reason}</p>
            <p className="muted">
              <time dateTime={decision.decidedAt}>{formatDate(decision.decidedAt)}</time>
              {" · "}{decision.decidedByName}{" · "}{decision.version}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
export default function DiscoveryPage() {
  const { id } = useParams();
  const { state, user, loading, error } = usePortal();
  const [editing, setEditing] = useState(false);
  const discovery = state.discoveries.find((d) => d.id === id);
  if (!discovery)
    return (
      <section className="empty-state">
        <h1>
          {loading
            ? "Loading discovery…"
            : error
              ? "Discovery unavailable"
              : "Discovery not found"}
        </h1>
        <p>
          {loading
            ? "Retrieving the research brief."
            : error
              ? "The research brief could not be loaded. Resolve the connection error above and try again."
              : "This investigation could not be found."}
        </p>
        <Link className="btn btn-primary" to="/">
          Back to discoveries
        </Link>
      </section>
    );
  return (
    <>
      <div className="discovery-breadcrumb">
        <Link to={isArchived(discovery.status) ? "/archive" : "/"}>
          <ArrowLeft size={16} />
          {isArchived(discovery.status) ? "Archive" : "All discoveries"}
        </Link>
      </div>
      <header className="discovery-header">
        <div className="split-row">
          <span className="field-label">
            {discovery.field === "Astronomy" ? (
              <Telescope size={16} />
            ) : (
              <Sparkles size={16} />
            )}{" "}
            {discovery.field} <span> / </span>{" "}
            {topics.find((t) => t.id === discovery.topic)?.label}
          </span>
          <StatusBadge status={discovery.status} />
        </div>
        <h1>{discovery.title}</h1>
        {discovery.question && <p className="discovery-question">{discovery.question}</p>}
        <p className="discovery-lead">{discovery.summary}</p>
        <div className="discovery-meta">
          <span>Manuscript {discovery.version}</span>
          <span>Updated {formatDate(discovery.updatedAt)}</span>
          <FollowDiscovery key={user?.id ?? "visitor"} discovery={discovery} />
          {user?.role === "Admin" && (
            <button
              className="btn btn-secondary btn-small"
              onClick={() => setEditing(!editing)}
              aria-expanded={editing}
            >
              <Pencil size={14} />
              {editing ? "Cancel editing" : "Edit discovery"}
            </button>
          )}
        </div>
      </header>
      <ArchiveNotice discovery={discovery} />
      {editing && user?.role === "Admin" && (
        <DiscoveryEditor
          key={discovery.id}
          discovery={discovery}
          onClose={() => setEditing(false)}
        />
      )}
      <div className="discovery-layout">
        <div>
          <div className="brief-intro">
            <span className="eyebrow">Research brief</span>
            <span>
              {discovery.sections.length} sections · {discovery.version}
            </span>
          </div>
          {discovery.headlineResult && <section className="discovery-headline" id="headline-result" tabIndex={-1} aria-labelledby="headline-result-heading">
            <h2 id="headline-result-heading">Headline result</h2>
            <figure className="headline-result">
              <Suspense fallback={<p>Loading mathematical result…</p>}>
                <Equation expression={discovery.headlineResult.equation} focusable label="Headline result equation" />
              </Suspense>
              <figcaption>{discovery.headlineResult.caption}</figcaption>
            </figure>
          </section>}
          <ResearchBrief discovery={discovery} />
          <div className="validation-callout">
            <span className="eyebrow">
              {discovery.status === "Awaiting Validation"
                ? "Open for examination"
                : "Review record"}
            </span>
            <p>{discovery.reviewNote}</p>
          </div>
          <StatusHistory discovery={discovery} />
          <Discussion key={discovery.id} discovery={discovery} />
        </div>
        <aside className="discovery-sidebar">
          <Materials key={discovery.id} discovery={discovery} />
          <ContentsNavigation key={`contents-${discovery.id}`} discovery={discovery} />
        </aside>
      </div>
    </>
  );
}
