import { useId, useState } from "react";
import { usePortal } from "../state/PortalContext";
import { topics } from "../data/topics";
import { activeStages, archiveStages } from "../data/discoveryStages";
import type { Discovery, DiscoveryUpdate, Stage, TopicId } from "../types";

export default function DiscoveryEditor({
  discovery,
  onClose,
}: {
  discovery: Discovery;
  onClose: () => void;
}) {
  const { updateDiscovery, user } = usePortal();
  const [draft, setDraft] = useState<Discovery>(structuredClone(discovery));
  const [initialStatus] = useState(discovery.status);
  const [statusChangeReason, setStatusChangeReason] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const reasonHelpId = useId();
  const statusChanged = draft.status !== initialStatus;
  const set = <K extends keyof Discovery>(key: K, value: Discovery[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  if (user?.role !== "Admin") return null;
  return (
    <section className="panel editor-panel">
      <div className="section-heading">
        <h2>Edit discovery · Admin only</h2>
        <button className="btn btn-secondary btn-small" onClick={onClose}>
          Close editor
        </button>
      </div>
      <p className="muted">
        Changes are shared with all readers. Keep the ID stable; update the
        manuscript version when the research changes. Existing discussion
        threads retain their original version.
      </p>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pending) return;
          const reason = statusChangeReason.trim();
          if (statusChanged && (reason.length < 10 || reason.length > 2000)) {
            setMessage("Provide a reason for the status change between 10 and 2,000 characters.");
            return;
          }
          setPending(true);
          setMessage("");
          try {
            const update: DiscoveryUpdate = { ...draft };
            // Status history belongs to the server; submit only the new reason.
            delete update.statusHistory;
            if (statusChanged) update.statusChangeReason = reason;
            const result = await updateDiscovery(update);
            setMessage(result.message);
            if (result.ok) onClose();
          } catch {
            setMessage("The discovery could not be saved. Please try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        <label className="field field-full">
          Title
          <input
            value={draft.title}
            maxLength={250}
            required
            onChange={(e) => set("title", e.target.value)}
          />
        </label>
        <label className="field">
          Status
          <select
            value={draft.status}
            onChange={(e) => set("status", e.target.value as Stage)}
          >
            <optgroup label="Active stages">
              {activeStages.map((s) => <option key={s}>{s}</option>)}
            </optgroup>
            <optgroup label="Archive outcomes">
              {archiveStages.map((s) => <option key={s}>{s}</option>)}
            </optgroup>
          </select>
        </label>
        <label className="field">
          Manuscript version
          <input
            value={draft.version}
            required
            maxLength={40}
            onChange={(e) => set("version", e.target.value)}
          />
        </label>
        <p className="status-change-note muted field-full">
          Archiving preserves the research brief, materials, and discussion. To
          restore an investigation, choose an active stage and explain the change.
        </p>
        {statusChanged && (
          <div className="field field-full">
            <label htmlFor={`${reasonHelpId}-input`}>Reason for status change</label>
            <textarea
              id={`${reasonHelpId}-input`}
              rows={3}
              required
              minLength={10}
              maxLength={2000}
              value={statusChangeReason}
              onChange={(e) => setStatusChangeReason(e.target.value)}
              aria-describedby={reasonHelpId}
            />
            <small className="status-change-note" id={reasonHelpId}>
              Visible to all readers in the status history. Use 10–2,000 characters.
            </small>
          </div>
        )}
        <label className="field field-full">
          Research topic
          <select
            value={draft.topic}
            onChange={(e) => {
              const topic = e.target.value as TopicId;
              setDraft((d) => ({
                ...d,
                topic,
                field: topics.find((t) => t.id === topic)!.field,
              }));
            }}
          >
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.field} / {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-full">
          Summary
          <textarea
            rows={3}
            required
            maxLength={3000}
            value={draft.summary}
            onChange={(e) => set("summary", e.target.value)}
          />
        </label>
        <label className="field field-full">
          Review focus or validation record
          <textarea
            rows={2}
            required
            maxLength={3000}
            value={draft.reviewNote}
            onChange={(e) => set("reviewNote", e.target.value)}
          />
        </label>
        {draft.sections.map((s, i) => (
          <fieldset className="field-full editor-section" key={s.id}>
            <legend>
              Section {i + 1} · {s.id}
            </legend>
            <label className="field">
              Section title
              <input
                required
                maxLength={250}
                value={s.title}
                onChange={(e) =>
                  set(
                    "sections",
                    draft.sections.map((section, index) =>
                      index === i
                        ? { ...section, title: e.target.value }
                        : section,
                    ),
                  )
                }
              />
            </label>
            <label className="field">
              Section content
              <textarea
                rows={5}
                required
                maxLength={20000}
                value={s.body}
                onChange={(e) =>
                  set(
                    "sections",
                    draft.sections.map((section, index) =>
                      index === i
                        ? { ...section, body: e.target.value }
                        : section,
                    ),
                  )
                }
              />
            </label>
            <label className="field">
              Equation (LaTeX, optional)
              <input
                value={s.equation ?? ""}
                maxLength={4000}
                onChange={(e) =>
                  set(
                    "sections",
                    draft.sections.map((section, index) =>
                      index === i
                        ? { ...section, equation: e.target.value }
                        : section,
                    ),
                  )
                }
              />
            </label>
          </fieldset>
        ))}
        <div className="field-full">
          <h3>Supporting materials</h3>
          <p className="muted">
            Manage material paths, external links, and access rules in the
            private discovery repository’s <code>discovery.json</code>. Saving
            this research brief preserves that configuration.
          </p>
        </div>
        {(
          Object.keys(draft.materials) as Array<keyof Discovery["materials"]>
        ).map((key) => (
          <label className="field" key={key}>
            {key === "repository"
              ? "GitHub repository"
              : key === "paper"
                ? "Full paper"
                : key.charAt(0).toUpperCase() + key.slice(1)}
            <input
              readOnly
              value={
                draft.materials[key]
                  ? "Available"
                  : draft.restrictedMaterials?.includes(key)
                    ? "Restricted material"
                    : "Not uploaded yet"
              }
            />
          </label>
        ))}
        <div className="field-full">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save discovery"}
          </button>
          {message && (
            <p className="notice notice-error" role="alert">
              {message}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
