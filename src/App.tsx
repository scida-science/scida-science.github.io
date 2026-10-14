import { useEffect, useState } from "react";
import {
  NavLink,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { ArrowRight, LogOut, RefreshCw } from "lucide-react";
import { usePortal } from "./state/PortalContext";
import { Brand } from "./components/Ui";
import HomePage from "./pages/HomePage";
import DiscoveryPage from "./pages/DiscoveryPage";
import ProfilePage from "./pages/ProfilePage";
import AccessPage from "./pages/AccessPage";
import AuthPage, { AuthCallbackPage } from "./pages/AuthPage";

function RouteFocus() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById("main-content")?.focus();
    document.title = `${pathname.startsWith("/discoveries/") ? "Discovery" : pathname === "/profile" ? "Research profile" : pathname === "/access" ? "Reviewer access" : pathname === "/login" ? "Account" : "Discoveries"} · SciDA`;
  }, [pathname]);
  return null;
}

export default function App() {
  const { user, signOut, configured, loading, error, refresh } = usePortal();
  const [signingOut, setSigningOut] = useState(false);
  const [accountError, setAccountError] = useState("");
  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link to="/" className="brand-link" aria-label="SciDA discoveries">
            <Brand />
          </Link>
          <nav className="primary-nav" aria-label="Main navigation">
            <NavLink end to="/">
              Discoveries
            </NavLink>
            {user && <NavLink to="/profile">My profile</NavLink>}
            <NavLink to="/access">Reviewer access</NavLink>
          </nav>
          <div className="account-controls">
            {configured && (
              <button
                className="icon-button"
                aria-label="Refresh research portal"
                title="Refresh research portal"
                disabled={loading}
                onClick={() => void refresh()}
              >
                <RefreshCw size={17} />
              </button>
            )}
            {user ? (
              <>
                <Link className="account-name" to="/profile">
                  {user.fullName || "My account"}
                  <small>{user.role}</small>
                </Link>
                <button
                  className="icon-button"
                  aria-label="Sign out"
                  title="Sign out"
                  disabled={signingOut}
                  onClick={async () => {
                    setSigningOut(true);
                    const result = await signOut();
                    setAccountError(result.ok ? "" : result.message);
                    setSigningOut(false);
                  }}
                >
                  <LogOut size={18} />
                </button>
              </>
            ) : (
              <Link className="btn btn-secondary btn-small" to="/login">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      {!configured && (
        <div className="notice configuration-notice" role="status">
          <strong>Account services are not configured yet.</strong> You can
          explore the six illustrative discoveries. Sign-in, discussions, and
          requests become available after the research portal is connected.
        </div>
      )}
      {(error || accountError) && (
        <div className="notice notice-error storage-notice" role="alert">
          {error || accountError}{" "}
          {error && (
            <button
              className="text-button"
              disabled={loading}
              onClick={() => void refresh()}
            >
              Try again
            </button>
          )}
        </div>
      )}
      {loading && (
        <p className="connection-status" role="status">
          Loading research portal…
        </p>
      )}
      <main id="main-content" className="main-container" tabIndex={-1}>
        <RouteFocus />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/discoveries/:id"
            element={<DiscoveryPage key={user?.id ?? "visitor"} />}
          />
          <Route
            path="/profile"
            element={
              loading && !user ? null : (
                <ProfilePage key={user?.id ?? "visitor"} />
              )
            }
          />
          <Route
            path="/access"
            element={
              loading && !user ? null : (
                <AccessPage key={user?.id ?? "visitor"} />
              )
            }
          />
          <Route
            path="/login"
            element={user ? <Navigate replace to="/profile" /> : <AuthPage />}
          />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route
            path="*"
            element={
              <div className="empty-state">
                <h1>Page not found</h1>
                <p>This page could not be found.</p>
                <Link className="btn btn-primary" to="/">
                  Return to discoveries
                </Link>
              </div>
            }
          />
        </Routes>
      </main>
      <footer className="site-footer">
        <span>
          <strong>SciDA</strong> <span className="footer-divider">/</span>{" "}
          Scientific Discovery Agent
        </span>
        <span>An evolving space for research and review.</span>
        <Link to="/access">
          About reviewer access <ArrowRight size={14} />
        </Link>
      </footer>
    </>
  );
}
