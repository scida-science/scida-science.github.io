import { Link } from "react-router-dom";
import { FilePenLine, MessageCircle, Reply } from "lucide-react";
import type { PortalNotification } from "../types";

export function notificationLink(notification: PortalNotification) {
  const query = new URLSearchParams();
  if (notification.commentId) query.set("comment", notification.commentId);
  if (notification.version) query.set("version", notification.version);
  const suffix = query.toString();
  return `/discoveries/${encodeURIComponent(notification.discoveryId)}${suffix ? `?${suffix}` : ""}`;
}

export function notificationReason(notification: PortalNotification) {
  if (notification.kind === "reply") return `${notification.actorName || "A researcher"} replied to your discussion`;
  if (notification.kind === "discussion") return `${notification.actorName || "A researcher"} posted in a discovery you follow`;
  return "A discovery you follow was updated";
}

function timestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default function NotificationList({ notifications, onRead }: {
  notifications: PortalNotification[];
  onRead: (ids: string[]) => void;
}) {
  return <ul className="notification-list">
    {notifications.map((notification) => {
      const Icon = notification.kind === "reply" ? Reply : notification.kind === "discussion" ? MessageCircle : FilePenLine;
      return <li key={notification.id}>
        <Link className={`notification-item${notification.read ? "" : " is-unread"}`}
          to={notificationLink(notification)}
          onClick={() => { if (!notification.read) onRead([notification.id]); }}>
          <Icon className="notification-event-icon" size={17} aria-hidden="true" />
          <span className="notification-copy">
            <span className="notification-reason">{!notification.read && <span className="sr-only">Unread. </span>}{notificationReason(notification)}</span>
            <strong>{notification.discoveryTitle}</strong>
            <span className="notification-meta">
              <time dateTime={notification.createdAt}>{timestamp(notification.createdAt)}</time>
              {notification.version && <span>Manuscript {notification.version}</span>}
              {notification.kind === "discovery-update" && notification.status && <span>{notification.status}</span>}
            </span>
          </span>
          {!notification.read && <span className="notification-unread-dot" aria-hidden="true" />}
        </Link>
      </li>;
    })}
  </ul>;
}
