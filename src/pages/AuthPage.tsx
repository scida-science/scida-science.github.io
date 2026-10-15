import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { BookOpen, Check, Github, ShieldCheck } from "lucide-react";
import { usePortal } from "../state/PortalContext";
import type { ActionResult } from "../types";

export function AuthCallbackPage() {
  const { user, configured, loading, error } = usePortal();
  if (user) return <Navigate replace to="/" />;
  return (
    <section className="panel stack account-callback">
      <span className="eyebrow">Researcher account</span>
      <h1>
        {loading
          ? "Completing GitHub sign-in…"
          : "Sign-in could not be completed"}
      </h1>
      <p>
        {loading
          ? "Verifying your account and loading discoveries."
          : error ||
            (configured
              ? "Return to sign in and start a new GitHub sign-in request."
              : "Account services are not configured yet.")}
      </p>
      {!loading && (
        <div>
          <Link className="btn btn-primary" to="/login">
            Return to sign in
          </Link>
        </div>
      )}
    </section>
  );
}

export default function AuthPage() {
  const { configured, signInWithGitHub } = usePortal();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div className="login-main account-page">
      <section className="login-intro">
        <span className="eyebrow">
          An open invitation to scientific inquiry
        </span>
        <h1>
          Discovery begins
          <br />
          with a question.
          <br />
          <em>Progress takes review.</em>
        </h1>
        <p>
          A place to examine discoveries from AI scientific research systems—and
          bring human expertise to the evidence.
        </p>
        <div className="login-principles">
          <span>
            <BookOpen size={18} /> Read the research
          </span>
          <span>
            <ShieldCheck size={18} /> Examine the evidence
          </span>
          <span>
            <Check size={18} /> Advance the discussion
          </span>
        </div>
      </section>
      <section className="login-panel panel stack">
        <span className="eyebrow">Researcher account</span>
        <h2>Welcome to SciDA</h2>
        {!configured ? (
          <>
            <p>
              Sign-in is unavailable until account services are connected.
            </p>
            <Link className="btn btn-secondary" to="/">
              Back to discoveries
            </Link>
          </>
        ) : (
          <>
            <p className="muted">
              Sign in to follow discoveries and apply to review research.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                setResult(null);
                try {
                  const outcome = await signInWithGitHub();
                  setResult(outcome);
                  if (!outcome.ok) setPending(false);
                } catch {
                  setResult({
                    ok: false,
                    message:
                      "The account service could not be reached. Please try again.",
                  });
                  setPending(false);
                }
              }}
            >
              <Github size={18} />
              {pending ? "Opening GitHub…" : "Sign in with GitHub"}
            </button>
            {result && (
              <p
                role={result.ok ? "status" : "alert"}
                className={`notice ${result.ok ? "notice-success" : "notice-error"}`}
              >
                {result.message}
              </p>
            )}
            <div className="auth-options">
              <a
                href="https://github.com/signup"
                target="_blank"
                rel="noopener noreferrer"
              >
                Create a GitHub account
              </a>
              <a
                href="https://github.com/password_reset"
                target="_blank"
                rel="noopener noreferrer"
              >
                Recover your GitHub account
              </a>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
