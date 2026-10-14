import type {
  Discovery,
  Profile,
  ReviewerApplication,
  TopicId,
} from "../types";

export function canDiscuss(
  user: Profile | null,
  discovery: Discovery,
): boolean {
  return (
    !!user &&
    user.role !== "Reader" &&
    user.approvedTopics.includes(discovery.topic)
  );
}

export function canManageTopic(user: Profile | null, topic: TopicId): boolean {
  return (
    !!user &&
    (user.role === "Admin" ||
      (user.role === "Approver" && user.assignedTopics.includes(topic)))
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
