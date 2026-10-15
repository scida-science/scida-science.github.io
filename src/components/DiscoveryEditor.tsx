import { useState } from "react";
import { usePortal } from "../state/PortalContext";
import { topics } from "../data/topics";
import { stages } from "./Ui";
import type { Discovery, Stage, TopicId } from "../types";

export default function DiscoveryEditor({
  discovery,
  onClose,
}: {
  discovery: Discovery;
  onClose: () => void;
}) {
  const { updateDiscovery } = usePortal();
  const [draft, setDraft] = useState<Discovery>(structuredClone(discovery));
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const set = <K extends keyof Discovery>(key: K, value: Discovery[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
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
          setPending(true);
          const result = await updateDiscovery(draft);
          setPending(false);
          setMessage(result.message);
          if (result.ok) onClose();
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
            {stages.map((s) => (
              <option key={s}>{s}</option>
            ))}
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
            <p className="notice" role="status">
              {message}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
