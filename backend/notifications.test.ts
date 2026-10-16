import { describe, expect, it } from "vitest";
import { discoveries } from "../test/fixtures/discoveries";
import type { Discovery, DiscussionComment } from "../src/types";
import type { ProfileRecord } from "./model";
import { deriveNotifications, readNotificationIds } from "./notifications";

const userId = "1001";
const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`;
const discovery = (overrides: Partial<Discovery> = {}): Discovery => ({
  ...structuredClone(discoveries[0]), updatedAt: at(1), ...overrides,
});
const profile = (overrides: Partial<ProfileRecord> = {}): ProfileRecord => ({
  profile: { fullName: "Reader", affiliation: "", researchRole: "", scholarUrl: "", website: "", fields: [], expertiseTopics: [], expertiseStatement: "", evidence: "" },
  email: "reader@example.test", githubLogin: "reader", ...overrides,
});
const comment = (id: string, overrides: Partial<DiscussionComment> = {}): DiscussionComment => ({
  id, discoveryId: "AI-001", authorId: "2002", authorName: "Researcher", parentId: null,
  version: "v0.2", reference: "", body: "Evidence to examine", createdAt: at(3), ...overrides,
});
const inbox = (comments: DiscussionComment[], account = profile(), items = [discovery()]) =>
  deriveNotifications(userId, account, items, comments);

describe("private notifications derived from visible activity", () => {
  it("notifies direct and ancestor authors, excludes one's own messages, and gives replies precedence over following", () => {
    const messages = [
      comment("root", { authorId: userId }),
      comment("direct", { parentId: "root", createdAt: at(4) }),
      comment("nested", { parentId: "direct", createdAt: at(5) }),
      comment("own", { parentId: "nested", authorId: userId, createdAt: at(6) }),
      comment("unrelated", { createdAt: at(7) }),
    ];
    expect(inbox(messages).map((item) => [item.commentId, item.kind])).toEqual([["nested", "reply"], ["direct", "reply"]]);
    const followed = inbox(messages, profile({ followedDiscoveryIds: ["AI-001"], followedSince: { "AI-001": at(2) } }));
    expect(followed.map((item) => [item.commentId, item.kind])).toEqual([["unrelated", "discussion"], ["nested", "reply"], ["direct", "reply"]]);
    expect(new Set(followed.map((item) => item.id)).size).toBe(3);
  });

  it("starts newly-followed activity at the saved timestamp while preserving replies to older threads", () => {
    const messages = [comment("old"), comment("root", { authorId: userId }),
      comment("reply", { parentId: "root", createdAt: at(4) }), comment("new", { createdAt: at(6) })];
    const account = profile({ followedDiscoveryIds: ["AI-001"], followedSince: { "AI-001": at(5) } });
    expect(inbox(messages, account).map((item) => item.commentId)).toEqual(["new", "reply"]);
    expect(inbox(messages, profile()).map((item) => item.commentId)).toEqual(["reply"]);
  });

  it("shows latest discovery changes to followers, with read receipts stable across reconstructed feeds", () => {
    const account = profile({ followedDiscoveryIds: ["AI-001"], followedSince: { "AI-001": at(2) } });
    const original = inbox([], account, [discovery({ updatedAt: at(3), status: "Refuted" })]);
    expect(original).toMatchObject([{ kind: "discovery-update", status: "Refuted", version: "v0.2", read: false }]);
    account.readNotificationIds = [original[0].id];
    expect(inbox([], account, [discovery({ updatedAt: at(3), status: "Refuted" })])[0].read).toBe(true);
    expect(inbox([], account, [discovery({ updatedAt: at(4), status: "Withdrawn" })])[0].read).toBe(false);
  });

  it("does not expose deleted or invisible discoveries, comments, or thread targets", () => {
    const account = profile({ followedDiscoveryIds: ["AI-001", "AST-001"] });
    expect(inbox([comment("root", { authorId: userId }), comment("hidden", { discoveryId: "AST-001", parentId: "root" })], account, [])).toEqual([]);
    const result = inbox([comment("root", { discoveryId: "AST-001", authorId: userId }), comment("cross", { parentId: "root" })], account);
    expect(result.every((item) => item.kind === "discovery-update")).toBe(true);
  });

  it("ignores invalid timestamps, cycles, ambiguous IDs, dangling parents, and cross-version links", () => {
    const messages = [
      comment("bad-time", { createdAt: "not a timestamp" }),
      comment("a", { parentId: "b", authorId: userId }), comment("b", { parentId: "a" }),
      comment("orphan", { parentId: "gone" }),
      comment("version-parent", { authorId: userId }), comment("version-child", { parentId: "version-parent", version: "v0.3" }),
      comment("duplicate"), comment("duplicate"), comment("duplicate-child", { parentId: "duplicate" }),
    ];
    expect(inbox(messages, profile({ followedDiscoveryIds: ["AI-001"] }), [discovery({ updatedAt: "invalid" })])).toEqual([]);
  });

  it("caps legacy-follow historical activity at the latest 100 and preserves exact comment anchors", () => {
    const messages = Array.from({ length: 150 }, (_, index) => comment(`comment-${index}`, {
      createdAt: new Date(Date.parse(at(3)) + index * 1000).toISOString(),
    }));
    const result = inbox(messages, profile({ followedDiscoveryIds: ["AI-001"] }));
    expect(result).toHaveLength(100);
    expect(result[0]).toMatchObject({ id: "comment:AI-001:comment-149", commentId: "comment-149", kind: "discussion", read: false });
    expect(result.at(-1)?.commentId).toBe("comment-50");
  });

  it("does not notify the recorded author about their own status change", () => {
    const updated = discovery({ updatedAt: at(3), status: "Refuted", statusHistory: [{ from: "Awaiting Validation", to: "Refuted", reason: "Evidence changed", decidedAt: at(3), decidedBy: userId, decidedByName: "Reader", version: "v0.2" }] });
    expect(inbox([], profile({ followedDiscoveryIds: ["AI-001"] }), [updated])).toEqual([]);
    updated.updatedAt = at(4);
    expect(inbox([], profile({ followedDiscoveryIds: ["AI-001"] }), [updated])).toHaveLength(1);
  });

  it("sanitizes and bounds private read receipts", () => {
    expect(readNotificationIds(null)).toEqual([]);
    expect(readNotificationIds(["bad", null, "comment:AI-001:one", "comment:AI-001:one"])).toEqual(["comment:AI-001:one"]);
    const ids = Array.from({ length: 1200 }, (_, index) => `comment:AI-001:c${index}`);
    expect(readNotificationIds(ids)).toEqual(ids.slice(-1000));
  });
});
