import type { Discovery, DiscussionComment, PortalNotification } from "../src/types";
import type { ProfileRecord } from "./model";

export const MAX_NOTIFICATIONS = 100;
export const MAX_READ_NOTIFICATION_IDS = 1000;
const discoveryId = /^[A-Z0-9][A-Za-z0-9_-]{1,79}$/;
const commentId = /^[A-Za-z0-9_-]{1,100}$/;
export const validNotificationId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(?:comment:[A-Z0-9][A-Za-z0-9_-]{1,79}:[A-Za-z0-9_-]{1,100}|update:[A-Z0-9][A-Za-z0-9_-]{1,79}:\d{1,16})$/.test(value);
export function readNotificationIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter(validNotificationId))].slice(-MAX_READ_NOTIFICATION_IDS)
    : [];
}
const timestamp = (value: unknown) => typeof value === "string" ? Date.parse(value) : NaN;
const key = (discovery: string, comment: string) => `${discovery}:${comment}`;

/** Pure projection of already-readable content: no GitHub calls or writes on reads. */
export function deriveNotifications(
  userId: string,
  profile: ProfileRecord,
  discoveries: Discovery[],
  comments: DiscussionComment[],
): PortalNotification[] {
  const readable = new Map(discoveries.filter((item) => discoveryId.test(item.id)).map((item) => [item.id, item]));
  const following = new Set(Array.isArray(profile.followedDiscoveryIds) ? profile.followedDiscoveryIds : []);
  const read = new Set(readNotificationIds(profile.readNotificationIds));
  const afterFollow = (id: string, at: number): boolean => {
    if (!following.has(id)) return false;
    const since = timestamp(profile.followedSince?.[id]);
    // Legacy follows retain their latest activity. New follows record their start.
    return !Number.isFinite(since) || at >= since;
  };
  const indexed = new Map<string, DiscussionComment | null>();
  for (const comment of comments) {
    if (!readable.has(comment.discoveryId) || !commentId.test(comment.id) ||
        !Number.isFinite(timestamp(comment.createdAt))) continue;
    const id = key(comment.discoveryId, comment.id);
    indexed.set(id, indexed.has(id) ? null : comment);
  }
  type Ancestry = { valid: boolean; authoredByUser: boolean };
  const ancestry = new Map<string, Ancestry>();
  // Cache chains so long discussions remain linear rather than quadratic.
  function parents(comment: DiscussionComment): Ancestry {
    const chain: DiscussionComment[] = [];
    const visited = new Set<string>();
    let cursor: DiscussionComment | undefined = comment;
    let result: Ancestry = { valid: true, authoredByUser: false };
    while (cursor) {
      const cursorKey = key(cursor.discoveryId, cursor.id);
      const cached = ancestry.get(cursorKey);
      if (cached) { result = cached; break; }
      if (visited.has(cursorKey)) { result = { valid: false, authoredByUser: false }; break; }
      visited.add(cursorKey);
      chain.push(cursor);
      if (cursor.parentId === null) break;
      const parent = indexed.get(key(cursor.discoveryId, cursor.parentId));
      if (!parent || parent.version !== cursor.version) {
        result = { valid: false, authoredByUser: false }; break;
      }
      cursor = parent;
    }
    for (const item of chain.reverse()) {
      result = { valid: result.valid, authoredByUser: result.valid && (result.authoredByUser || item.authorId === userId) };
      ancestry.set(key(item.discoveryId, item.id), result);
    }
    return ancestry.get(key(comment.discoveryId, comment.id)) ?? result;
  }
  const result: PortalNotification[] = [];
  for (const comment of indexed.values()) {
    if (!comment || comment.authorId === userId) continue;
    const chain = parents(comment);
    if (!chain.valid) continue;
    const at = timestamp(comment.createdAt);
    const reply = comment.parentId !== null && chain.authoredByUser;
    if (!reply && !afterFollow(comment.discoveryId, at)) continue;
    const id = `comment:${comment.discoveryId}:${comment.id}`;
    result.push({
      id, kind: reply ? "reply" : "discussion",
      discoveryId: comment.discoveryId, discoveryTitle: readable.get(comment.discoveryId)!.title,
      createdAt: comment.createdAt, read: read.has(id), commentId: comment.id,
      version: comment.version, ...(comment.authorName ? { actorName: comment.authorName } : {}),
    });
  }
  for (const discovery of readable.values()) {
    const at = timestamp(discovery.updatedAt);
    if (!Number.isFinite(at) || at < 0 || !afterFollow(discovery.id, at)) continue;
    const lastDecision = discovery.statusHistory?.at(-1);
    // An exact recorded decision can identify one's own status change. Other
    // repository edits have no reliable author in discovery.json.
    if (lastDecision?.decidedBy === userId && timestamp(lastDecision.decidedAt) === at) continue;
    const id = `update:${discovery.id}:${at}`;
    result.push({
      id, kind: "discovery-update", discoveryId: discovery.id, discoveryTitle: discovery.title,
      createdAt: discovery.updatedAt, read: read.has(id), version: discovery.version, status: discovery.status,
    });
  }
  return result.sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt) || a.id.localeCompare(b.id)).slice(0, MAX_NOTIFICATIONS);
}
