import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  CircleHelp,
  Clock3,
  Search,
  SlidersHorizontal,
  Telescope,
  Sparkles,
} from "lucide-react";
import { usePortal } from "../state/PortalContext";
import { topics } from "../data/discoveries";
import { StatusBadge, formatDate, stages } from "../components/Ui";
import type { Field, Stage } from "../types";

export default function HomePage() {
  const { state, user, loading, error } = usePortal();
  const [field, setField] = useState<Field | "Recent discoveries">(
    "Recent discoveries",
  );
  const [stage, setStage] = useState<Stage | "All stages">("All stages");
  const [query, setQuery] = useState("");
  const fields = [
    "Recent discoveries",
    "Astronomy",
    "Artificial Intelligence",
  ] as const;
  const items = state.discoveries
    .filter(
      (d) =>
        (field === "Recent discoveries" || d.field === field) &&
        (stage === "All stages" || d.status === stage) &&
        `${d.title} ${d.summary} ${topics.find((t) => t.id === d.topic)?.label}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (state.discoveries.length === 0 && (loading || error))
    return (
      <section className="empty-state">
        <h1>{loading ? "Loading discoveries…" : "Discoveries unavailable"}</h1>
        <p>
          {loading
            ? "Retrieving the latest research briefs."
            : "The discovery list could not be loaded. Resolve the connection error above and try again."}
        </p>
      </section>
    );
  return (
    <>
      <section className="home-hero">
        <div>
          <span className="eyebrow">
            <span className="tiny-line" />
            The research observatory
          </span>
          <h1>
            New questions.
            <br />
            <em>Shared discoveries.</em>
          </h1>
          <p>
            Explore discoveries from AI scientific research systems.
          </p>
        </div>
        <div className="hero-note">
          <span className="hero-number">
            {String(state.discoveries.length).padStart(2, "0")}
            <span> / discoveries</span>
          </span>
          <div className="hero-note-rule" />
          <span>Astronomy · Artificial Intelligence</span>
        </div>
      </section>
      <div className="home-layout">
        <section className="discovery-feed" aria-label="Discovery feed">
          <div
            className="research-tabs"
            role="tablist"
            aria-label="Research area"
          >
            {fields.map((f, index) => (
              <button
                key={f}
                id={`field-${index}`}
                role="tab"
                aria-selected={field === f}
                aria-controls="discovery-results"
                tabIndex={field === f ? 0 : -1}
                onClick={() => setField(f)}
                onKeyDown={(e) => {
                  let next = index;
                  if (e.key === "ArrowRight")
                    next = (index + 1) % fields.length;
                  else if (e.key === "ArrowLeft")
                    next = (index + fields.length - 1) % fields.length;
                  else if (e.key === "Home") next = 0;
                  else if (e.key === "End") next = fields.length - 1;
                  else return;
                  e.preventDefault();
                  setField(fields[next]);
                  document.getElementById(`field-${next}`)?.focus();
                }}
              >
                {f === "Astronomy" ? (
                  <Telescope size={16} />
                ) : f === "Artificial Intelligence" ? (
                  <Sparkles size={16} />
                ) : (
                  <Clock3 size={16} />
                )}
                <span>{f}</span>
              </button>
            ))}
          </div>
          <div className="feed-toolbar">
            <p aria-live="polite">
              <strong>{items.length}</strong>{" "}
              {items.length === 1 ? "discovery" : "discoveries"}
              <span className="muted"> · Latest updates first</span>
            </p>
            <div className="filter-controls">
              <label className="search-field">
                <Search size={15} />
                <span className="sr-only">Search discoveries</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search discoveries"
                />
              </label>
              <label className="stage-filter">
                <SlidersHorizontal size={14} />
                <span className="sr-only">Discovery status</span>
                <select
                  value={stage}
                  onChange={(e) =>
                    setStage(e.target.value as Stage | "All stages")
                  }
                >
                  <option>All stages</option>
                  {stages.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div
            id="discovery-results"
            role="tabpanel"
            aria-labelledby={`field-${fields.indexOf(field)}`}
          >
            {items.map((d) => (
              <article className="discovery-card" key={d.id}>
                <Link
                  to={`/discoveries/${d.id}`}
                  className="discovery-card-link"
                >
                  <div className="card-topline">
                    <span className="field-label">
                      {d.field === "Astronomy" ? (
                        <Telescope size={15} />
                      ) : (
                        <Sparkles size={15} />
                      )}{" "}
                      {d.field}
                      <span className="label-dot">·</span>
                      <span>{topics.find((t) => t.id === d.topic)?.label}</span>
                    </span>
                    <StatusBadge status={d.status} />
                  </div>
                  <h2>
                    {d.title}
                    <ArrowUpRight size={22} />
                  </h2>
                  <p className="discovery-summary">{d.summary}</p>
                  <div className="review-note">
                    <span>
                      {d.status === "Awaiting Validation" ? (
                        <CircleHelp size={16} />
                      ) : (
                        <CheckCheck size={16} />
                      )}
                    </span>
                    <p>
                      <strong>
                        {d.status === "Awaiting Validation"
                          ? "Review focus"
                          : d.status === "Published"
                            ? d.illustrative
                              ? "Illustrative publication record"
                              : "Publication record"
                            : d.illustrative
                              ? "Illustrative validation record"
                              : "Validation record"}
                      </strong>{" "}
                      {d.reviewNote.replace(
                        /^(Review focus|(?:Illustrative )?validation record|(?:Illustrative )?publication record):\s*/i,
                        "",
                      )}
                    </p>
                  </div>
                  <div className="card-bottomline">
                    <span className="example-label">
                      {d.illustrative && (
                        <>
                          Illustrative example <span>·</span>{" "}
                        </>
                      )}
                      {d.id}
                    </span>
                    <span>
                      Updated {formatDate(d.updatedAt)} <ArrowRight size={15} />
                    </span>
                  </div>
                </Link>
              </article>
            ))}
            {items.length === 0 && (
              <div className="empty-state">
                <Search size={28} />
                <h2>No discoveries match</h2>
                <p>Try another field, stage, or search term.</p>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setField("Recent discoveries");
                    setStage("All stages");
                    setQuery("");
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        </section>
        <aside className="home-sidebar">
          <section className="mission-panel">
            <span className="eyebrow">Science, in the open</span>
            <h2>
              A finding is the
              <br />
              start of a conversation.
            </h2>
            <p>
              Examine research briefs, supporting evidence, and open questions.
            </p>
            <Link to="/access">
              Explore reviewer access <ArrowUpRight size={17} />
            </Link>
            <div className="orbit-illustration" aria-hidden="true">
              <div />
              <div />
              <div />
              <span />
            </div>
          </section>
          <section className="stages-panel">
            <h3>Validation stages</h3>
            <div>
              <span className="stage-step">01</span>
              <p>
                <strong>Awaiting Validation</strong>
                <small>A proposed finding awaiting expert review.</small>
              </p>
            </div>
            <div>
              <span className="stage-step">02</span>
              <p>
                <strong>Validated</strong>
                <small>
                  Review checks recorded; limitations remain visible.
                </small>
              </p>
            </div>
            <div>
              <span className="stage-step">03</span>
              <p>
                <strong>Published</strong>
                <small>
                  Publication details and supporting materials when available.
                </small>
              </p>
            </div>
            {state.discoveries.some((discovery) => discovery.illustrative) && (
              <p className="sidebar-disclaimer">
                “Illustrative example” entries are placeholders, not validated or
                published research.
              </p>
            )}
          </section>
          <section className="reviewer-callout">
            <span className="small-icon">
              <ShieldIcon />
            </span>
            <h3>Review by topic</h3>
            <p>
              Apply to discuss discoveries within your areas of expertise.
            </p>
            <Link to={!user || user.role === "Reader" ? "/access" : "/profile"}>
              {!user || user.role === "Reader"
                ? "Apply to review"
                : "View your research profile"}{" "}
              <ArrowRight size={15} />
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}
function ShieldIcon() {
  return <CheckCheck size={20} />;
}
