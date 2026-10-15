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
} from "lucide-react";
import { usePortal } from "../state/PortalContext";
import { topics } from "../data/topics";
import { StatusBadge, formatDate } from "../components/Ui";
import Discussion from "../components/Discussion";
import DiscoveryEditor from "../components/DiscoveryEditor";
import EvidenceFigure from "../components/EvidenceFigure";
import FollowDiscovery from "../components/FollowDiscovery";
import ReviewerPackage from "../components/ReviewerPackage";
import type { ActionResult, Discovery } from "../types";

const Equation = lazy(() => import("../components/Equation"));

const materialNames: Array<{
  key: keyof Discovery["materials"];
  label: string;
  icon: typeof FileText;
}> = [
  { key: "paper", label: "Full paper", icon: FileText },
  { key: "appendix", label: "Appendix", icon: BookOpen },
  { key: "figures", label: "Figures", icon: Image },
  { key: "data", label: "Data", icon: Database },
  { key: "repository", label: "Analysis code", icon: Code2 },
];
function Materials({ discovery }: { discovery: Discovery }) {
  const { state, user, requestCode, downloadMaterial, configured, error } =
    usePortal();
  const [open, setOpen] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [message, setMessage] = useState("");
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
  return (
    <>
      <section className="materials-panel panel">
        <span className="eyebrow">Inspect the evidence</span>
        <h2>Supporting materials</h2>
        {materialNames.map(({ key, label, icon: Icon }) => (
          <div className="material-row" key={key}>
            <Icon size={18} />
            <div>
              <strong>{label}</strong>
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
                        ? "Open analysis code"
                        : `Open ${label.toLowerCase()}`}
                  </button>
                ) : (
                  <span>
                    Materials unavailable until account services are connected
                  </span>
                )
              ) : discovery.restrictedMaterials?.includes(key) ? (
                <>
                  <span>Restricted material</span>
                  <Link
                    to={user ? "/access" : "/login"}
                    aria-label={`${user ? "Request access to" : "Sign in to access"} ${label.toLowerCase()}`}
                  >
                    {user
                      ? "Request topic-specific access"
                      : "Sign in to inspect access"}
                  </Link>
                </>
              ) : (
                <span>Not uploaded yet</span>
              )}
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
        {user && configured ? (
          <button
            className="btn btn-secondary request-code-button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            <Code2 size={16} />
            {open ? "Close request form" : "Request code"}
          </button>
        ) : (
          <p className="muted">
            {configured ? (
              <Link to="/login">Sign in to request code</Link>
            ) : (
              "Code requests are unavailable until account services are connected."
            )}
          </p>
        )}
        {open && user && (
          <form
            className="stack request-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              const result = await requestCode(discovery.id, explanation);
              setPending(false);
              setMessage(result.message);
              if (result.ok) setExplanation("");
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
              automatically grant repository access.
            </small>
            {message && (
              <p className="notice" role="status">
                {message}
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
            {s.body.split(/\n\s*\n/).map((paragraph, paragraphIndex) => (
              <p key={paragraphIndex}>{paragraph}</p>
            ))}
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
                <Equation expression={s.equation} />
              </Suspense>
            )}
          </div>
        </section>
      ))}
    </div>
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
        <Link to="/">
          <ArrowLeft size={16} />
          All discoveries
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
      {editing && (
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
          <ResearchBrief discovery={discovery} />
          <div className="validation-callout">
            <span className="eyebrow">
              {discovery.status === "Awaiting Validation"
                ? "Open for examination"
                : "Review record"}
            </span>
            <p>{discovery.reviewNote}</p>
          </div>
          <Discussion key={discovery.id} discovery={discovery} />
        </div>
        <aside className="discovery-sidebar">
          <Materials key={discovery.id} discovery={discovery} />
          <nav className="contents-panel" aria-label="On this page">
            <h3>In this brief</h3>
            {discovery.sections.map((s, i) => (
              <button
                key={s.id}
                onClick={() => {
                  const element = document.getElementById(`section-${s.id}`);
                  element?.scrollIntoView({
                    behavior: window.matchMedia(
                      "(prefers-reduced-motion: reduce)",
                    ).matches
                      ? "auto"
                      : "smooth",
                  });
                  element?.focus({ preventScroll: true });
                }}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                {s.title}
              </button>
            ))}
            <a
              href="#discussion"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("discussion")?.scrollIntoView();
              }}
            >
              Research discussion ↓
            </a>
          </nav>
        </aside>
      </div>
    </>
  );
}
