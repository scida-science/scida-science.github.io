import { useState } from "react";
import { Link } from "react-router-dom";
import { topics } from "../data/discoveries";
import { formatDate } from "../components/Ui";
import { canReviewApplication } from "../services/permissions";
import { usePortal } from "../state/PortalContext";
import type {
  ActionResult,
  Invitation,
  Profile,
  ReviewerApplication,
  Role,
  TopicId,
} from "../types";

function topicNames(ids: TopicId[]) {
  return ids
    .map((id) => topics.find((topic) => topic.id === id)?.label ?? id)
    .join(", ");
}

function TopicChoices({
  value,
  onChange,
  allowed = topics.map((topic) => topic.id),
  label,
  disabled = false,
}: {
  value: TopicId[];
  onChange: (value: TopicId[]) => void;
  allowed?: TopicId[];
  label: string;
  disabled?: boolean;
}) {
  const [selectedField, setSelectedField] = useState("");
  const availableTopics = topics.filter((topic) => allowed.includes(topic.id));
  const fields = [...new Set(availableTopics.map((topic) => topic.field))];
  const field = fields.find((item) => item === selectedField) ?? "";
  const selectedTopics = topics.filter((topic) => value.includes(topic.id));
  return (
    <fieldset disabled={disabled}>
      <legend>{label}</legend>
      {fields.length > 0 && (
        <label className="field">
          Research field
          <select
            className="select"
            aria-label={`Research field for ${label}`}
            value={field}
            onChange={(event) => setSelectedField(event.target.value)}
          >
            <option value="">Choose a research field</option>
            {fields.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      )}
      {field && (
        <div className="checkbox-list">
          {availableTopics
            .filter((topic) => topic.field === field)
            .map((topic) => (
              <label className="checkbox-row" key={topic.id}>
                <input
                  type="checkbox"
                  checked={value.includes(topic.id)}
                  onChange={() =>
                    onChange(
                      value.includes(topic.id)
                        ? value.filter((id) => id !== topic.id)
                        : [...value, topic.id],
                    )
                  }
                />
                <span>
                  {topic.label}
                  <span className="muted"> · {topic.field}</span>
                </span>
              </label>
            ))}
        </div>
      )}
      {selectedTopics.length > 0 && (
        <div className="stack" aria-label={`Selected ${label.toLowerCase()}`}>
          <span className="muted">Selected topics</span>
          <div className="button-row">
            {selectedTopics.map((topic) => (
              <button
                className="btn btn-secondary"
                type="button"
                key={topic.id}
                aria-label={`Remove ${topic.label} from ${label.toLowerCase()}`}
                onClick={() => onChange(value.filter((id) => id !== topic.id))}
              >
                {topic.label} <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {fields.length === 0 && (
        <p className="muted">No topics are available in your current scope.</p>
      )}
    </fieldset>
  );
}

function Result({ result }: { result: ActionResult | null }) {
  return result ? (
    <p
      role={result.ok ? "status" : "alert"}
      className={`notice ${result.ok ? "notice-success" : "notice-error"}`}
    >
      {result.message}
    </p>
  ) : null;
}

function ApplicationReview({
  application,
  applicant,
  onDecision,
}: {
  application: ReviewerApplication;
  applicant?: Profile;
  onDecision: (result: ActionResult) => void;
}) {
  const { reviewApplication } = usePortal();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const decide = async (decision: "Approved" | "Declined") => {
    setPending(true);
    onDecision(await reviewApplication(application.id, decision, note));
    setPending(false);
  };
  return (
    <article className="access-record stack">
      <div className="split-row">
        <h3>{applicant?.fullName || "Researcher"}</h3>
        <span className="tag">{application.status}</span>
      </div>
      <p className="muted">
        {applicant?.affiliation} · {applicant?.researchRole}
      </p>
      <p>
        <strong>Requested topics:</strong> {topicNames(application.topics)}
      </p>
      <div>
        <h4>Application evidence</h4>
        <p className="preserve-lines">{application.evidence}</p>
      </div>
      {applicant?.expertiseStatement && (
        <p>
          <strong>Expertise statement:</strong> {applicant.expertiseStatement}
        </p>
      )}
      {applicant?.scholarUrl && (
        <a
          href={applicant.scholarUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Applicant’s Google Scholar profile (opens a new tab)
        </a>
      )}
      <label className="field">
        Decision note for {applicant?.fullName || "this applicant"}
        <textarea
          className="textarea"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={2000}
          disabled={pending}
          placeholder="Explain the topic-specific approval or missing evidence."
        />
      </label>
      <div className="button-row">
        <button
          className="btn btn-primary"
          type="button"
          disabled={pending}
          onClick={() => void decide("Approved")}
        >
          Approve requested topics
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={pending}
          onClick={() => void decide("Declined")}
        >
          Decline application
        </button>
      </div>
    </article>
  );
}

function ManageAccount({
  profile,
  onSaved,
}: {
  profile: Profile;
  onSaved: (result: ActionResult) => void;
}) {
  const { setAccess } = usePortal();
  const [role, setRole] = useState<Role>(profile.role);
  const [approved, setApproved] = useState<TopicId[]>(profile.approvedTopics);
  const [assigned, setAssigned] = useState<TopicId[]>(profile.assignedTopics);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);
  if (profile.role === "Admin")
    return (
      <article className="access-record">
        <div className="split-row">
          <h3>{profile.fullName}</h3>
          <span className="tag">Admin</span>
        </div>
        <p className="muted">
          Admin access cannot be changed here.
        </p>
      </article>
    );
  return (
    <form
      className="access-record stack"
      onSubmit={async (event) => {
        event.preventDefault();
        if ((role === "Reviewer" || role === "Approver") && !approved.length)
          return setResult({
            ok: false,
            message: `Choose at least one approved review topic for a ${role}.`,
          });
        if (role === "Senior Approver" && !assigned.length)
          return setResult({
            ok: false,
            message:
              "Choose at least one assigned approval topic for a Senior Approver.",
          });
        setPending(true);
        const outcome = await setAccess(
          profile.id,
          role,
          role === "Reader" ? [] : approved,
          role === "Senior Approver" ? assigned : [],
        );
        setResult(outcome);
        onSaved(outcome);
        setPending(false);
      }}
    >
      <div className="split-row">
        <h3>{profile.fullName}</h3>
        <span className="tag">{profile.role}</span>
      </div>
      {profile.githubLogin && <p className="muted">@{profile.githubLogin}</p>}
      <label className="field">
        Role for {profile.fullName}
        <select
          className="select"
          value={role}
          disabled={pending}
          onChange={(event) => {
            setRole(event.target.value as Role);
            setResult(null);
          }}
        >
          <option>Reader</option>
          <option>Reviewer</option>
          <option>Approver</option>
          <option>Senior Approver</option>
        </select>
      </label>
      {(role === "Reviewer" ||
        role === "Approver" ||
        role === "Senior Approver") && (
        <TopicChoices
          label={`Approved review topics for ${profile.fullName}`}
          value={approved}
          onChange={setApproved}
          disabled={pending}
        />
      )}
      {role === "Senior Approver" && (
        <TopicChoices
          label={`Assigned approval topics for ${profile.fullName}`}
          value={assigned}
          onChange={setAssigned}
          disabled={pending}
        />
      )}
      {role === "Reader" && (
        <p className="muted">
          Saving Reader access removes approved review topics and approval
          responsibilities.
        </p>
      )}
      <Result result={result} />
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? "Saving…" : `Save access for ${profile.fullName}`}
        </button>
      </div>
    </form>
  );
}

export default function AccessPage() {
  const {
    state,
    user,
    applyForReview,
    createInvitation,
    previewInvitation,
    confirmInvitation,
    configured,
    error,
  } = usePortal();
  const [requestedTopics, setRequestedTopics] = useState<TopicId[]>([]);
  const [evidence, setEvidence] = useState(user?.evidence ?? "");
  const [applicationResult, setApplicationResult] =
    useState<ActionResult | null>(null);
  const [applicationPending, setApplicationPending] = useState(false);
  const [invitationCode, setInvitationCode] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [previewCode, setPreviewCode] = useState("");
  const [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [invitationResult, setInvitationResult] = useState<ActionResult | null>(
    null,
  );
  const [invitationPending, setInvitationPending] = useState(false);
  const [inviteTopics, setInviteTopics] = useState<TopicId[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [createResult, setCreateResult] = useState<
    (ActionResult & { code?: string }) | null
  >(null);
  const [createPending, setCreatePending] = useState(false);
  const [decisionResult, setDecisionResult] = useState<ActionResult | null>(
    null,
  );
  const [accessResult, setAccessResult] = useState<ActionResult | null>(null);
  const [researcherQuery, setResearcherQuery] = useState("");

  if (!user)
    return (
      <section className="panel stack">
        <span className="eyebrow">Research community</span>
        <h1>Reviewer access</h1>
        <p>
          Browse discoveries and discussions. Posting requires
          reviewer approval for the discovery’s topic.
        </p>
        <p>
          Sign in and complete your research profile to apply.
        </p>
        {configured ? (
          <div>
            <Link className="btn btn-primary" to="/login">
              Sign in or create an account
            </Link>
          </div>
        ) : (
          <p className="notice">
            Reviewer applications are unavailable until account services are
            connected.
          </p>
        )}
      </section>
    );

  const myApplications = state.applications
    .filter((application) => application.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const invitationMatches =
    invitation?.intendedEmail.toLowerCase() === user.email.toLowerCase();
  const isApprover = user.role === "Senior Approver" || user.role === "Admin";
  const allowedInvitationTopics =
    user.role === "Admin"
      ? topics.map((topic) => topic.id)
      : user.assignedTopics;
  const reviewable = state.applications.filter(
    (application) =>
      application.status === "Pending" &&
      canReviewApplication(user, application),
  );
  const createdInvitations = state.invitations.filter(
    (item) => item.createdBy === user.id,
  );
  const researcherSearch = researcherQuery.trim().toLocaleLowerCase();
  const matchingResearchers = new Set(
    state.profiles
      .filter((profile) =>
        [
          profile.fullName,
          profile.githubLogin ?? "",
          profile.affiliation,
          profile.email,
          profile.id,
          profile.role,
        ].some((value) => value.toLocaleLowerCase().includes(researcherSearch)),
      )
      .map((profile) => profile.id),
  );

  return (
    <div className="stack">
      <header className="page-heading">
        <p className="eyebrow">Research community</p>
        <h1>Reviewer access</h1>
        <p className="muted">
          Approval applies only to the listed review topics.
        </p>
      </header>
      {error && (
        <p className="notice notice-error">
          Access records may be incomplete while the connection error above is
          unresolved.
        </p>
      )}
      <section className="panel stack" aria-labelledby="current-access">
        <div className="section-heading">
          <h2 id="current-access">Your current access</h2>
        </div>
        <div className="split-row">
          <p>
            <strong>{user.fullName}</strong>
          </p>
          <span className="tag">{user.role}</span>
        </div>
        <p>
          <strong>Approved review topics:</strong>{" "}
          {topicNames(user.approvedTopics) || "None yet"}
        </p>
        {user.role === "Senior Approver" && (
          <p>
            <strong>Assigned approval topics:</strong>{" "}
            {topicNames(user.assignedTopics) || "None"}
          </p>
        )}
      </section>

      <section className="panel stack" aria-labelledby="apply-heading">
        <div className="section-heading">
          <h2 id="apply-heading">Apply for reviewer access</h2>
          <p className="muted">
            Select topics and provide relevant evidence. Access begins after
            approval.
          </p>
        </div>
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setApplicationPending(true);
            const outcome = await applyForReview(requestedTopics, evidence);
            setApplicationResult(outcome);
            if (outcome.ok) setRequestedTopics([]);
            setApplicationPending(false);
          }}
        >
          <TopicChoices
            label="Requested review topics"
            value={requestedTopics}
            onChange={setRequestedTopics}
            allowed={topics
              .filter((topic) => !user.approvedTopics.includes(topic.id))
              .map((topic) => topic.id)}
            disabled={applicationPending}
          />
          <label className="field">
            Evidence for this application
            <textarea
              className="textarea"
              rows={4}
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              required
              minLength={10}
              maxLength={6000}
              disabled={applicationPending}
              placeholder="Relevant papers, projects, thesis, or code; explain your contribution."
            />
          </label>
          <p className="muted">
            Edit your affiliation, Scholar URL, and expertise in{" "}
            <Link to="/profile">your profile</Link>.
          </p>
          <Result result={applicationResult} />
          <div>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={!requestedTopics.length || applicationPending}
            >
              {applicationPending
                ? "Submitting…"
                : "Submit reviewer application"}
            </button>
          </div>
        </form>
        {myApplications.length > 0 && (
          <div className="stack">
            <h3>Your applications</h3>
            {myApplications.map((application) => (
              <article className="access-record" key={application.id}>
                <div className="split-row">
                  <strong>{topicNames(application.topics)}</strong>
                  <span className="tag">{application.status}</span>
                </div>
                <p className="muted">
                  Submitted{" "}
                  {new Date(application.createdAt).toLocaleDateString(
                    undefined,
                    { year: "numeric", month: "short", day: "numeric" },
                  )}
                </p>
                {application.decisionNote && (
                  <p>
                    <strong>Decision note:</strong> {application.decisionNote}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel stack" aria-labelledby="invitation-heading">
        <div className="section-heading">
          <h2 id="invitation-heading">Use an invitation</h2>
          <p className="muted">
            Check the intended account and topics before accepting.
          </p>
        </div>
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setInvitationPending(true);
            setInvitation(null);
            setScopeConfirmed(false);
            const code = invitationCode.trim();
            const outcome = await previewInvitation(code);
            setPreviewCode(code);
            setInvitation(
              outcome.ok && outcome.invitation ? outcome.invitation : null,
            );
            setInvitationResult(outcome.ok ? null : outcome);
            setInvitationPending(false);
          }}
        >
          <label className="field">
            Invitation code
            <input
              className="input"
              value={invitationCode}
              onChange={(event) => {
                setInvitationCode(event.target.value);
                setInvitation(null);
                setPreviewCode("");
                setScopeConfirmed(false);
                setInvitationResult(null);
              }}
              required
              maxLength={200}
              autoComplete="off"
              disabled={invitationPending}
            />
          </label>
          <div>
            <button
              className="btn btn-secondary"
              type="submit"
              disabled={invitationPending}
            >
              {invitationPending ? "Checking…" : "Review invitation scope"}
            </button>
          </div>
        </form>
        {invitation && (
          <div className="access-record stack">
            <h3>Confirm invitation scope</h3>
            <p>
              <strong>Intended email:</strong> {invitation.intendedEmail}
            </p>
            <p>
              <strong>Review topics:</strong> {topicNames(invitation.topics)}
            </p>
            <p className="muted">
              Accepting adds reviewer access for these topics only. It does not
              grant approver, senior approver, or admin privileges.
            </p>
            {invitation.usedBy ? (
              <p className="notice">
                This invitation has already been accepted.
              </p>
            ) : !invitationMatches ? (
              <p className="notice notice-error">
                This invitation is addressed to a different email. Sign in with
                the intended account to accept it.
              </p>
            ) : (
              <>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={scopeConfirmed}
                    onChange={(event) =>
                      setScopeConfirmed(event.target.checked)
                    }
                    disabled={invitationPending}
                  />
                  I confirm this invitation is for my email and grants review
                  access only to the topics shown above.
                </label>
                <div>
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={!scopeConfirmed || invitationPending}
                    onClick={async () => {
                      setInvitationPending(true);
                      const outcome = await confirmInvitation(
                        previewCode,
                        scopeConfirmed ? invitation.topics : [],
                      );
                      setInvitationResult(outcome);
                      if (outcome.ok) {
                        setScopeConfirmed(false);
                        setInvitation(null);
                        setInvitationCode("");
                        setPreviewCode("");
                      }
                      setInvitationPending(false);
                    }}
                  >
                    {invitationPending
                      ? "Accepting…"
                      : "Accept confirmed invitation"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <Result result={invitationResult} />
      </section>

      {isApprover && (
        <>
          <section className="panel stack" aria-labelledby="queue-heading">
            <div className="section-heading">
              <h2 id="queue-heading">Review applications</h2>
              <p className="muted">
                {user.role === "Admin"
                  ? "You can review applications in every topic."
                  : `Your assigned approval scope: ${topicNames(user.assignedTopics) || "none"}.`}{" "}
                Approval grants only the requested reviewer topics.
              </p>
            </div>
            <Result result={decisionResult} />
            {reviewable.length ? (
              reviewable.map((application) => (
                <ApplicationReview
                  key={application.id}
                  application={application}
                  applicant={state.profiles.find(
                    (profile) => profile.id === application.userId,
                  )}
                  onDecision={setDecisionResult}
                />
              ))
            ) : (
              <p className="muted">
                {error
                  ? "Application queue is unavailable while the connection error is unresolved."
                  : "No pending applications fall entirely within your approval scope."}
              </p>
            )}
          </section>
          <section
            className="panel stack"
            aria-labelledby="create-invitation-heading"
          >
            <div className="section-heading">
              <h2 id="create-invitation-heading">Invite a reviewer</h2>
              <p className="muted">
                Create a code for an email and review topics. Share it directly;
                no email is sent. The recipient must confirm the scope to gain
                access.
              </p>
            </div>
            <form
              className="stack"
              onSubmit={async (event) => {
                event.preventDefault();
                setCreatePending(true);
                setCreateResult(
                  await createInvitation(inviteTopics, inviteEmail.trim()),
                );
                setCreatePending(false);
              }}
            >
              <label className="field">
                Intended recipient email
                <input
                  className="input"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => {
                    setInviteEmail(event.target.value);
                    setCreateResult(null);
                  }}
                  required
                  maxLength={254}
                  disabled={createPending}
                />
              </label>
              <TopicChoices
                label="Invitation review topics"
                value={inviteTopics}
                onChange={(value) => {
                  setInviteTopics(value);
                  setCreateResult(null);
                }}
                allowed={allowedInvitationTopics}
                disabled={createPending}
              />
              <Result result={createResult} />
              {createResult?.ok && createResult.code && (
                <p className="invitation-code">
                  <strong>Invitation code (shown once):</strong>{" "}
                  <code>{createResult.code}</code>
                  <br />
                  <small className="muted">
                    Copy this code now and share it privately with the intended
                    recipient.
                  </small>
                </p>
              )}
              <div>
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={!inviteTopics.length || createPending}
                >
                  {createPending ? "Creating…" : "Create invitation"}
                </button>
              </div>
            </form>
            {createdInvitations.length > 0 && (
              <div className="stack">
                <h3>Invitations you created</h3>
                {createdInvitations.map((item) => (
                  <article className="access-record" key={item.id}>
                    <div className="split-row">
                      <strong>{item.intendedEmail}</strong>
                      <span className="tag">
                        {item.usedBy
                          ? "Accepted"
                          : "Awaiting scope confirmation"}
                      </span>
                    </div>
                    <p className="muted">{topicNames(item.topics)}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {user.role === "Admin" && (
        <section
          className="panel stack"
          aria-labelledby="code-requests-heading"
        >
          <div className="section-heading">
            <h2 id="code-requests-heading">Research code requests</h2>
            <p className="muted">
              Latest requests first. A request does not grant repository access.
            </p>
          </div>
          {state.codeRequests.length > 0 ? (
            [...state.codeRequests]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((request) => {
                const requester = state.profiles.find(
                  (profile) => profile.id === request.userId,
                );
                const discovery = state.discoveries.find(
                  (item) => item.id === request.discoveryId,
                );
                return (
                  <article className="access-record stack" key={request.id}>
                    <div className="split-row">
                      <h3>{requester?.fullName || "Researcher"}</h3>
                      <time className="muted" dateTime={request.createdAt}>
                        {formatDate(request.createdAt)}
                      </time>
                    </div>
                    <p className="muted">Account ID: {request.userId}</p>
                    <Link to={`/discoveries/${request.discoveryId}`}>
                      {discovery?.title || request.discoveryId}
                    </Link>
                    <p className="preserve-lines">{request.explanation}</p>
                  </article>
                );
              })
          ) : (
            <p className="muted">
              {error
                ? "Code requests are unavailable while the connection error is unresolved."
                : "No code requests have been submitted yet."}
            </p>
          )}
        </section>
      )}

      {user.role === "Admin" && (
        <section className="panel stack" aria-labelledby="admin-access-heading">
          <div className="section-heading">
            <h2 id="admin-access-heading">Manage researcher access</h2>
            <p className="muted">
              Set review topics and appoint Senior Approvers to approve or
              invite reviewers within assigned topics.
            </p>
          </div>
          <Result result={accessResult} />
          <label className="field">
            Search researchers
            <input
              className="input"
              type="search"
              value={researcherQuery}
              onChange={(event) => setResearcherQuery(event.target.value)}
              placeholder="Name, GitHub username, affiliation, or role"
              autoComplete="off"
            />
          </label>
          <p className="muted" role="status">
            {matchingResearchers.size === 0
              ? "No researchers match your search."
              : `${matchingResearchers.size} ${matchingResearchers.size === 1 ? "researcher" : "researchers"}`}
          </p>
          {state.profiles.map((profile) => (
            <div key={profile.id} hidden={!matchingResearchers.has(profile.id)}>
              <ManageAccount
                key={`${profile.id}-${profile.role}-${profile.approvedTopics.join(",")}-${profile.assignedTopics.join(",")}`}
                profile={profile}
                onSaved={setAccessResult}
              />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
