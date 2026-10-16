import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bell, CheckCheck, X } from "lucide-react";
import { usePortal } from "../state/PortalContext";
import NotificationList from "./NotificationList";
import "./Notifications.css";

export default function NotificationBell() {
  const { user, state, loading, error, refresh, markNotificationsRead } = usePortal();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [readError, setReadError] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const initialFocus = useRef<"first" | "last" | null>(null);
  const panelId = useId();
  const headingId = useId();
  const location = useLocation();
  const notifications = state.notifications ?? [];
  const unread = notifications.filter((notification) => !notification.read);

  function focusItem(position: "first" | "last") {
    const items = panel.current?.querySelectorAll<HTMLElement>("a, button:not(:disabled)");
    if (items?.length) items[position === "first" ? 0 : items.length - 1].focus();
  }
  useEffect(() => { setOpen(false); }, [location.key, user?.id]);
  useEffect(() => { setReadError(""); }, [user?.id]);
  useEffect(() => {
    if (!open) return;
    if (initialFocus.current) {
      focusItem(initialFocus.current);
      initialFocus.current = null;
    }
    const outside = (event: Event) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function navigateItems(event: KeyboardEvent<HTMLElement>) {
    const items = [...(panel.current?.querySelectorAll<HTMLElement>("a, button:not(:disabled)") ?? [])];
    if (!items.length) return;
    let next = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") next = (next + 1) % items.length;
    else if (event.key === "ArrowUp") next = (next - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    items[next].focus();
  }

  async function markRead(ids: string[]) {
    setPending(true);
    setReadError("");
    try {
      const result = await markNotificationsRead(ids);
      if (!result.ok) setReadError(result.message);
    } catch {
      setReadError("Could not save notification read status. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!user) return null;
  return <div className="notification-bell" ref={container}>
    <button className="notification-trigger" ref={trigger} type="button"
      aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ""}`}
      title="Notifications" aria-expanded={open} aria-controls={panelId}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const position = event.key === "ArrowDown" ? "first" : "last";
        if (open) focusItem(position);
        else { initialFocus.current = position; setOpen(true); }
      }}>
      <Bell size={20} aria-hidden="true" />
      {unread.length > 0 && <span className="notification-badge" aria-hidden="true">{unread.length > 99 ? "99+" : unread.length}</span>}
    </button>
    {open && <section className="notification-panel" id={panelId} ref={panel} aria-labelledby={headingId} onKeyDown={navigateItems}>
      <div className="notification-panel-heading">
        <h2 id={headingId}>Notifications</h2>
        {unread.length > 0 && <button className="text-button" type="button" disabled={pending}
          onClick={() => void markRead(unread.map((notification) => notification.id))}>
          <CheckCheck size={15} aria-hidden="true" />{pending ? "Saving…" : "Mark all read"}
        </button>}
      </div>
      {error && <p className="notification-message notice-error" role="alert">Notifications could not be refreshed. <button className="text-button" disabled={loading} onClick={() => void refresh()}>Try again</button></p>}
      {loading && !notifications.length ? <p className="notification-message" role="status">Loading notifications…</p>
        : !notifications.length && !error ? <p className="notification-message">You’re all caught up. Replies and activity on discoveries you follow will appear here.</p>
        : <NotificationList notifications={notifications.slice(0, 5)} onRead={(ids) => void markRead(ids)} />}
      <Link className="notification-view-all" to="/notifications">View all notifications</Link>
    </section>}
    {readError && <div className="notification-read-error notice-error" role="alert">
      <span>{readError}</span><button className="icon-button" type="button" aria-label="Dismiss notification error" onClick={() => setReadError("")}><X size={16} aria-hidden="true" /></button>
    </div>}
  </div>;
}
