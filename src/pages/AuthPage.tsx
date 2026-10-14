import { useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Check, ShieldCheck } from "lucide-react";
import { usePortal } from "../state/PortalContext";
import type { ActionResult } from "../types";

export default function AuthPage({ recovery = false }: { recovery?: boolean }) {
  const {
    configured,
    loading,
    signIn,
    signUp,
    requestPasswordReset,
    updatePassword,
  } = usePortal();
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const title = recovery
    ? "Choose a new password"
    : mode === "register"
      ? "Create your account"
      : mode === "reset"
        ? "Recover your account"
        : "Welcome to SciDA";
  const switchMode = (next: typeof mode) => {
    setMode(next);
    setResult(null);
    setPassword("");
  };
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
        <h2>{title}</h2>
        {!configured ? (
          <>
            <p>
              Account registration and sign-in are unavailable until account
              services are connected. No account information can be submitted
              yet.
            </p>
            <Link className="btn btn-secondary" to="/">
              Explore illustrative discoveries
            </Link>
          </>
        ) : (
          <>
            <p className="muted">
              {recovery
                ? "Set a new password for the account verified by your recovery link."
                : mode === "register"
                  ? "New accounts start as Readers. Confirm your email before signing in, then complete your research profile to apply for topic-specific review access."
                  : mode === "reset"
                    ? "Enter your account email to request a password recovery link."
                    : "Sign in with your email and password to manage your profile and reviewer access."}
            </p>
            <form
              className="stack"
              onSubmit={async (event) => {
                event.preventDefault();
                setPending(true);
                setResult(null);
                try {
                  setResult(
                    await (recovery
                      ? updatePassword(password)
                      : mode === "register"
                        ? signUp(email.trim(), password, fullName.trim())
                        : mode === "reset"
                          ? requestPasswordReset(email.trim())
                          : signIn(email.trim(), password)),
                  );
                } catch {
                  setResult({
                    ok: false,
                    message:
                      "The account service could not be reached. Please try again.",
                  });
                } finally {
                  setPending(false);
                }
              }}
            >
              {!recovery && mode === "register" && (
                <label className="field">
                  Full name
                  <input
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    required
                    maxLength={120}
                    autoComplete="name"
                    disabled={pending}
                  />
                </label>
              )}
              {!recovery && (
                <label className="field">
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    maxLength={254}
                    autoComplete="email"
                    disabled={pending}
                  />
                </label>
              )}
              {(recovery || mode !== "reset") && (
                <label className="field">
                  {recovery ? "New password" : "Password"}
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={mode === "register" || recovery ? 12 : 1}
                    maxLength={256}
                    autoComplete={
                      recovery || mode === "register"
                        ? "new-password"
                        : "current-password"
                    }
                    disabled={pending}
                  />
                  {(recovery || mode === "register") && (
                    <span className="muted">Use at least 12 characters.</span>
                  )}
                </label>
              )}
              {result && (
                <p
                  role={result.ok ? "status" : "alert"}
                  className={`notice ${result.ok ? "notice-success" : "notice-error"}`}
                >
                  {result.message}
                </p>
              )}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={pending || loading}
              >
                {pending
                  ? "Please wait…"
                  : recovery
                    ? "Update password"
                    : mode === "register"
                      ? "Create account"
                      : mode === "reset"
                        ? "Send recovery email"
                        : "Sign in"}
              </button>
            </form>
            {!recovery && (
              <div className="auth-options">
                {mode === "login" ? (
                  <>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => switchMode("register")}
                      disabled={pending}
                    >
                      Create an account
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => switchMode("reset")}
                      disabled={pending}
                    >
                      Forgot password?
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => switchMode("login")}
                    disabled={pending}
                  >
                    Back to sign in
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
