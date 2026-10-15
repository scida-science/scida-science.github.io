import { useState } from "react";
import EvidenceFigure from "../components/EvidenceFigure";
import FollowDiscovery from "../components/FollowDiscovery";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Archive,
  CheckCheck,
  CircleHelp,
  Clock3,
  Search,
  SlidersHorizontal,
  Telescope,
  Sparkles,
} from "lucide-react";
import { usePortal } from "../state/PortalContext";
import { topics } from "../data/topics";
import { activeStages, archiveDescriptions, archiveStages, isArchived, stages } from "../data/discoveryStages";
import { hasResearchInterests, orderDiscoveries } from "../lib/discoveryFeed";
import { StatusBadge, formatDate } from "../components/Ui";
import type { Discovery, Field, Stage } from "../types";

type FeedTab = Field | "For you" | "Recent discoveries" | "All fields";
const researchFields = [...new Set(topics.map((topic) => topic.field))];
const tabId = (tab: FeedTab) =>
  `research-tab-${tab.toLowerCase().replaceAll(" ", "-")}`;
const archiveReason = (discovery: Discovery) =>
  [...(discovery.statusHistory ?? [])].reverse().find((decision) => decision.to === discovery.status)?.reason;

export default function HomePage({ followingOnly = false, archiveOnly = false }: { followingOnly?: boolean; archiveOnly?: boolean }) {
  const { state, user, configured, loading, error } = usePortal();
  const [selectedTab, setSelectedTab] = useState<FeedTab | null>(null);
  const [stage, setStage] = useState<Stage | "All stages">("All stages");
  const [query, setQuery] = useState("");
  const personalized = !followingOnly && !archiveOnly && hasResearchInterests(user);
  const followed = new Set(user?.followedDiscoveryIds ?? []);
  const available = followingOnly
    ? state.discoveries.filter((discovery) => followed.has(discovery.id))
    : state.discoveries.filter((discovery) => isArchived(discovery.status) === archiveOnly);
  const filterStages = followingOnly ? stages : archiveOnly ? archiveStages : activeStages;
  const defaultTab = archiveOnly ? "All fields" : "Recent discoveries";
  const fields: FeedTab[] = [
    ...(personalized ? ["For you" as const] : []),
    defaultTab,
    ...researchFields,
  ];
  const field = selectedTab && fields.includes(selectedTab)
    ? selectedTab
    : personalized ? "For you" : defaultTab;
  const items = orderDiscoveries(
    available.filter(
      (d) =>
        (field === "Recent discoveries" || field === "For you" || field === "All fields" || d.field === field) &&
        (stage === "All stages" || d.status === stage) &&
        `${d.title} ${d.summary} ${topics.find((t) => t.id === d.topic)?.label} ${isArchived(d.status) ? archiveReason(d) ?? "" : ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ),
    field === "For you" ? user : null,
  );
  if (state.discoveries.length === 0 && (!configured || loading || error))
    return (
      <section className="empty-state">
        <h1>{loading ? "Loading discoveries…" : "Discoveries unavailable"}</h1>
        <p>
          {loading
            ? "Retrieving the latest research briefs."
            : !configured
              ? "The research portal is not connected yet."
              : "The discovery list could not be loaded. Please try again."}
        </p>
      </section>
    );
  if (followingOnly && !user && !loading) return <section className="empty-state">
    <h1>Following</h1>
    <p>Sign in to keep the discoveries you follow together.</p>
    <Link className="btn btn-primary" to="/login">Sign in with GitHub</Link>
  </section>;
  return (
    <>
      <section className={`home-hero${archiveOnly ? " archive-hero" : ""}`}>
        <div>
          <span className="eyebrow">
            <span className="tiny-line" />
            {followingOnly ? "Your reading list" : archiveOnly ? "The research record" : "The research observatory"}
          </span>
          {followingOnly ? <h1>Following</h1> : archiveOnly ? <h1>Archive</h1> : <h1>
            New questions.
            <br />
            <em>Shared discoveries.</em>
          </h1>}
          <p>
            {followingOnly ? "The discoveries you follow, including any later archived outcomes." : archiveOnly ? "Investigations with a recorded review outcome. Briefs, evidence, and discussions remain available." : "Explore discoveries from AI scientific research systems."}
          </p>
        </div>
        <div className="hero-note">
          <span className="hero-number">
            {String(available.length).padStart(2, "0")}
            <span> / discoveries</span>
          </span>
          <div className="hero-note-rule" />
          <span>{[...new Set(available.map((discovery) => discovery.field))].join(" · ")}</span>
        </div>
      </section>
      <div className={`home-layout${archiveOnly ? " archive-layout" : ""}`}>
        <section className="discovery-feed" aria-label={archiveOnly ? "Archived discoveries" : "Discovery feed"}>
          <div
            className="research-tabs"
            role="tablist"
            aria-label="Research area"
          >
            {fields.map((f, index) => (
              <button
                key={f}
                id={tabId(f)}
                role="tab"
                aria-selected={field === f}
                aria-controls="discovery-results"
                tabIndex={field === f ? 0 : -1}
                onClick={() => setSelectedTab(f)}
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
                  setSelectedTab(fields[next]);
                  document.getElementById(tabId(fields[next]))?.focus();
                }}
              >
                {f === "Astronomy" ? (
                  <Telescope size={16} />
                ) : f === "Artificial Intelligence" || f === "For you" ? (
                  <Sparkles size={16} />
                ) : f === "All fields" ? (
                  <Archive size={16} />
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
              <span className="muted">
                {field === "For you"
                  ? " · Your topics and fields first"
                  : " · Latest updates first"}
              </span>
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
                <span className="sr-only">{archiveOnly ? "Archive outcome" : "Discovery status"}</span>
                <select
                  value={stage}
                  onChange={(e) =>
                    setStage(e.target.value as Stage | "All stages")
                  }
                >
                  <option value="All stages">{archiveOnly ? "All outcomes" : "All stages"}</option>
                  {filterStages.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div
            id="discovery-results"
            role="tabpanel"
            aria-labelledby={tabId(field)}
          >
            {items.map((d) => (
              <article className={`discovery-card${isArchived(d.status) ? " archived-card" : ""}`} key={d.id}>
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
                  {d.question && <p className="discovery-question">{d.question}</p>}
                  <p className="discovery-summary">{d.summary}</p>
                  {d.figures?.filter((f) => f.id === d.headlineFigureId).map((f) => (
                    <EvidenceFigure key={f.id} discoveryId={d.id} figure={f} revision={d.revision ?? d.updatedAt} />
                  ))}
                  <div className={`review-note${isArchived(d.status) ? " archive-review-note" : ""}`}>
                    <span>
                      {isArchived(d.status) ? (
                        <Archive size={16} aria-hidden="true" />
                      ) : d.status === "Awaiting Validation" ? (
                        <CircleHelp size={16} />
                      ) : (
                        <CheckCheck size={16} />
                      )}
                    </span>
                    <p>
                      <strong>
                        {isArchived(d.status)
                          ? `Archived · ${d.status}`
                          : d.status === "Awaiting Validation"
                          ? "Review focus"
                          : d.status === "Published"
                            ? "Publication record"
                            : "Validation record"}
                      </strong>{" "}
                      {isArchived(d.status) ? archiveReason(d) ?? archiveDescriptions[d.status] : d.reviewNote.replace(
                        /^(Review focus|(?:Illustrative )?validation record|(?:Illustrative )?publication record):\s*/i,
                        "",
                      )}
                    </p>
                  </div>
                  <div className="card-bottomline">
                    <span>Read the investigation</span>
                    <span>
                      Updated {formatDate(d.updatedAt)} <ArrowRight size={15} />
                    </span>
                  </div>
                </Link>
                <div className="discovery-card-actions">
                  <FollowDiscovery key={user?.id ?? "visitor"} discovery={d} />
                </div>
              </article>
            ))}
            {items.length === 0 && (
              <div className="empty-state">
                <Search size={28} />
                <h2>{followingOnly && !available.length ? "No followed discoveries yet" : available.length ? "No discoveries match" : archiveOnly ? "No archived investigations" : "No discoveries available yet"}</h2>
                <p>{followingOnly && !available.length
                  ? "Follow an investigation from Explore to find it here."
                  : available.length
                  ? `Try another field, ${archiveOnly ? "outcome" : "stage"}, or search term.`
                  : archiveOnly ? "Investigations marked Not supported, Refuted, or Withdrawn will appear here with their recorded reasons."
                  : "New investigations will appear here when they are available."}</p>
                {followingOnly && !available.length && <Link className="btn btn-primary" to="/">Explore discoveries</Link>}
                {available.length > 0 && <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setSelectedTab(null);
                    setStage("All stages");
                    setQuery("");
                  }}
                >
                  Clear filters
                </button>}
              </div>
            )}
          </div>
        </section>
        <aside className="home-sidebar">
          {!archiveOnly && <section className="mission-panel">
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
          </section>}
          {archiveOnly ? <section className="stages-panel archive-outcomes">
            <h3>Archive outcomes</h3>
            {archiveStages.map((outcome) => <div key={outcome}>
              <Archive size={17} aria-hidden="true" />
              <p><strong>{outcome}</strong><small>{archiveDescriptions[outcome]}</small></p>
            </div>)}
            <Link to="/">Explore active investigations <ArrowRight size={15} /></Link>
          </section> : <section className="stages-panel">
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
            <Link className="archive-link" to="/archive">Browse the archive <ArrowRight size={15} /></Link>
          </section>}
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
