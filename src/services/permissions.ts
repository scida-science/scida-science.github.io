import type {
  Discovery,
  Profile,
  ReviewerApplication,
  TopicId,
} from "../types";
import { topicIds } from "./validation";

// Keep explicit review grants separate from access inherited through the current
// approval role, so changing or removing approval scope also removes that access.
export function reviewTopics(user: Profile | null): TopicId[] {
  if (!user || user.role === "Reader") return [];
  return topicIds.filter(
    (topic) => user.approvedTopics.includes(topic) || canManageTopic(user, topic),
  );
}

export function canDiscuss(
  user: Profile | null,
  discovery: Discovery,
): boolean {
  return reviewTopics(user).includes(discovery.topic);
}

export function canManageTopic(user: Profile | null, topic: TopicId): boolean {
  return (
    !!user &&
    (user.role === "Admin" ||
      (user.role === "Senior Approver" && user.assignedTopics.includes(topic)))
  );
}

export function canReviewApplication(
  user: Profile | null,
  application: ReviewerApplication,
): boolean {
  return (
    !!user &&
    user.id !== application.userId &&
    application.status === "Pending" &&
    application.topics.length > 0 &&
    application.topics.every((topic) => canManageTopic(user, topic))
  );
}
