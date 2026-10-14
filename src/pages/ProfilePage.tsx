import { useState } from "react";
import { Link } from "react-router-dom";
import { topics } from "../data/discoveries";
import { reviewTopics } from "../services/permissions";
import { usePortal } from "../state/PortalContext";
import type { ActionResult, Field, ProfileInput, TopicId } from "../types";

const researchFields: Field[] = ["Astronomy", "Artificial Intelligence"];

export default function ProfilePage() {
  const { user, state, saveProfile } = usePortal();
  const [draft, setDraft] = useState<ProfileInput>(() => ({
    fullName: user?.fullName ?? "",
    affiliation: user?.affiliation ?? "",
    researchRole: user?.researchRole ?? "",
    scholarUrl: user?.scholarUrl ?? "",
    website: user?.website ?? "",
    fields: user?.fields ?? [],
    expertiseTopics: (user?.expertiseTopics ?? []).filter((id) =>
      topics.some(
        (topic) => topic.id === id && user?.fields.includes(topic.field),
      ),
    ),
    expertiseStatement: user?.expertiseStatement ?? "",
    evidence: user?.evidence ?? "",
  }));
  const [result, setResult] = useState<ActionResult | null>(null);

  const [pending, setPending] = useState(false);

  if (!user)
    return (
      <div className="panel">
        <p>Sign in to edit your research profile.</p>
        <Link to="/login">Sign in or create an account</Link>
      </div>
    );

  const applications = state.applications.filter(
    (application) => application.userId === user.id,
  );
  const effectiveReviewTopics = reviewTopics(user);
  const latestApplication = [...applications].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0];
  const set = <K extends keyof ProfileInput>(
    key: K,
    value: ProfileInput[K],
  ) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setResult(null);
  };
  const availableTopics = topics.filter((topic) =>
    draft.fields.includes(topic.field),
  );
  const toggleField = (field: Field) => {
    setDraft((previous) => {
      const selectedFields = previous.fields.includes(field)
        ? previous.fields.filter((value) => value !== field)
        : [...previous.fields, field];
      return {
        ...previous,
        fields: selectedFields,
        expertiseTopics: previous.expertiseTopics.filter((id) =>
          topics.some(
            (topic) => topic.id === id && selectedFields.includes(topic.field),
          ),
        ),
      };
    });
    setResult(null);
  };
  const toggleTopic = (topic: TopicId) =>
    set(
      "expertiseTopics",
      draft.expertiseTopics.includes(topic)
        ? draft.expertiseTopics.filter((value) => value !== topic)
        : [...draft.expertiseTopics, topic],
    );

  return (
    <div className="stack">
      <header className="page-heading">
        <p className="eyebrow">Researcher profile</p>
        <h1>Your research profile</h1>
      </header>

      <form
        className="panel stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setResult(await saveProfile(draft));
          setPending(false);
        }}
      >
        <div className="section-heading">
          <h2>Profile details</h2>
        </div>
        <div className="form-grid">
          <label className="field">
            Full name
            <input
              className="input"
              value={draft.fullName}
              onChange={(event) => set("fullName", event.target.value)}
              required
              maxLength={120}
              autoComplete="name"
            />
          </label>
          <label className="field">
            Private email
            <input
              className="input"
              type="email"
              value={user.email}
              readOnly
              required
              maxLength={200}
              autoComplete="email"
            />
            <span className="muted">
              Verified account email. Not displayed in discussions.
            </span>
          </label>
          <label className="field">
            Affiliation
            <input
              className="input"
              value={draft.affiliation}
              onChange={(event) => set("affiliation", event.target.value)}
              required
              maxLength={200}
              autoComplete="organization"
            />
          </label>
          <label className="field">
            Research role
            <input
              className="input"
              value={draft.researchRole}
              onChange={(event) => set("researchRole", event.target.value)}
              required
              maxLength={120}
              placeholder="e.g. Doctoral researcher"
            />
          </label>
          <label className="field">
            Google Scholar profile URL <span className="muted">(optional)</span>
            <input
              className="input"
              type="url"
              value={draft.scholarUrl}
              onChange={(event) => set("scholarUrl", event.target.value)}
              placeholder="https://scholar.google.com/citations?user=…"
              maxLength={1000}
            />
          </label>
          <label className="field">
            Research website <span className="muted">(optional)</span>
            <input
              className="input"
              type="url"
              value={draft.website}
              onChange={(event) => set("website", event.target.value)}
              placeholder="https://…"
              maxLength={1000}
            />
          </label>
        </div>
        <fieldset>
          <legend>Research fields</legend>
          <div className="checkbox-list">
            {researchFields.map((field) => (
              <label className="checkbox-row" key={field}>
                <input
                  type="checkbox"
                  checked={draft.fields.includes(field)}
                  onChange={() => toggleField(field)}
                />
                {field}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Specific expertise topics</legend>
          <p className="muted">
            These describe your expertise. Discussion permissions are granted
            separately.
          </p>
          <div className="checkbox-list">
            {availableTopics.map((topic) => (
              <label className="checkbox-row" key={topic.id}>
                <input
                  type="checkbox"
                  checked={draft.expertiseTopics.includes(topic.id)}
                  onChange={() => toggleTopic(topic.id)}
                />
                <span>
                  {topic.label}
                  <span className="muted"> · {topic.field}</span>
                </span>
              </label>
            ))}
          </div>
          {availableTopics.length === 0 && (
            <p className="muted">
              Select a research field to choose expertise topics.
            </p>
          )}
        </fieldset>
        <label className="field">
          Brief expertise statement <span className="muted">(optional)</span>
          <textarea
            className="textarea"
            rows={3}
            value={draft.expertiseStatement}
            onChange={(event) => set("expertiseStatement", event.target.value)}
            maxLength={2000}
            placeholder="Describe the methods, questions, or research communities you know well."
          />
        </label>
        <label className="field">
          Application evidence
          <textarea
            className="textarea"
            rows={4}
            value={draft.evidence}
            onChange={(event) => set("evidence", event.target.value)}
            maxLength={6000}
            placeholder="Relevant papers, projects, thesis, or code, with a short explanation of your contribution."
          />
          <span className="muted">
            Saving evidence does not submit a reviewer application.
          </span>
        </label>
        {result && (
          <p
            role="status"
            className={`notice ${result.ok ? "notice-success" : "notice-error"}`}
          >
            {result.message}
          </p>
        )}
        <div>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>

      <section className="panel stack" aria-labelledby="reviewer-standing">
        <div className="section-heading">
          <h2 id="reviewer-standing">Reviewer access</h2>
        </div>
        <dl className="profile-facts">
          <div>
            <dt>Current role</dt>
            <dd>{user.role}</dd>
          </div>
          <div>
            <dt>Reviewer application status</dt>
            <dd>{latestApplication?.status ?? "Not submitted"}</dd>
          </div>
          <div>
            <dt>Approved review topics</dt>
            <dd>
              {effectiveReviewTopics.length > 0
                ? effectiveReviewTopics
                    .map(
                      (id) =>
                        topics.find((topic) => topic.id === id)?.label ?? id,
                    )
                    .join(", ")
                : "No approved topics yet"}
            </dd>
          </div>
          {user.role === "Senior Approver" && (
            <div>
              <dt>Assigned approval topics</dt>
              <dd>
                {user.assignedTopics
                  .map(
                    (id) =>
                      topics.find((topic) => topic.id === id)?.label ?? id,
                  )
                  .join(", ") || "No topics assigned"}
              </dd>
            </div>
          )}
        </dl>
        <div>
          <Link className="btn btn-secondary" to="/access">
            Manage reviewer access
          </Link>
        </div>
      </section>
    </div>
  );
}
