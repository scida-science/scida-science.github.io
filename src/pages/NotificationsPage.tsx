import { useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import { usePortal } from "../state/PortalContext";
import NotificationList from "../components/NotificationList";
import "../components/Notifications.css";

export default function NotificationsPage() {
  const { user, state, loading, error, refresh, markNotificationsRead } = usePortal();
  const [pending, setPending] = useState(false);
  const [readError, setReadError] = useState("");
  const notifications = state.notifications ?? [];
  const unread = notifications.filter((notification) => !notification.read);
  async function markRead(ids: string[]) {
    setPending(true);
    setReadError("");
    try {
      const result = await markNotificationsRead(ids);
      if (!result.ok) setReadError(result.message);
    } catch {
      setReadError("Could not save notification read status. Please try again.");
    } finally { setPending(false); }
  }
  return <div className="notifications-page">
    <div className="page-heading">
      <span className="eyebrow"><Bell size={16} aria-hidden="true" />Your research activity</span>
      <h1>Notifications</h1>
      <p>Replies to your discussions and activity on discoveries you follow.</p>
    </div>
    {!user ? loading ? <p role="status">Loading notifications…</p> : <div className="panel">
      <p>Sign in to see your notifications.</p><Link className="btn btn-primary" to="/login">Sign in with GitHub</Link>
    </div> : <section className="notifications-inbox" aria-label="Your notifications">
      <div className="notifications-toolbar">
        <span className="muted">{unread.length ? `${unread.length} unread` : "All read"}</span>
        {unread.length > 0 && <button className="btn btn-secondary btn-small" type="button" disabled={pending}
          onClick={() => void markRead(unread.map((notification) => notification.id))}>
          <CheckCheck size={16} aria-hidden="true" />{pending ? "Saving…" : "Mark all read"}
        </button>}
      </div>
      {readError && <p className="notice notice-error" role="alert">{readError}</p>}
      {error && <p className="notice notice-error" role="alert">Notifications could not be refreshed. <button className="text-button" disabled={loading} onClick={() => void refresh()}>Try again</button></p>}
      {loading && !notifications.length ? <p role="status">Loading notifications…</p>
        : !notifications.length && !error ? <div className="notification-empty"><Bell size={26} aria-hidden="true" /><h2>You’re all caught up</h2><p>Follow a discovery to receive updates here.</p><Link to="/">Explore discoveries</Link></div>
        : <NotificationList notifications={notifications} onRead={(ids) => void markRead(ids)} />}
    </section>}
  </div>;
}
