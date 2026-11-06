import { describe, expect, it, vi } from "vitest";
import type { AuthorizeTeamAccessCollection } from "../../teams/server/authorize-team-access";
import { getThreadWithReplies, type GetThreadWithRepliesDeps } from "./get-thread-with-replies";

// TASK-015 review follow-up: the thread read maps each auth outcome to its own refusal (TASK-009 caller propagation).
// Only a genuine rejection is `unauthenticated`; the two fence outcomes keep their own codes.

const TEAM_ID = "team-42";
const THREAD_ID = "thread-1";
const MEMBER_UID = "member-1";

function memberAccess(): AuthorizeTeamAccessCollection {
  return {
    async getTeamStatus() {
      return "active";
    },
    async getMembership(uid, teamId) {
      return uid === MEMBER_UID && teamId === TEAM_ID ? { uid, teamId } : undefined;
    },
  };
}

function depsFor(overrides: Partial<GetThreadWithRepliesDeps>): GetThreadWithRepliesDeps {
  return {
    verifyToken: vi.fn().mockResolvedValue({ uid: MEMBER_UID, email: "m@example.com", email_verified: true }),
    isSuperadmin: async () => false,
    authCollection: memberAccess(),
    threadReader: { getThread: vi.fn(async () => undefined) },
    repliesReader: { listOrderedForThread: vi.fn(async () => []) },
    readFence: async () => ({ kind: "none" as const }),
    ...overrides,
  };
}

describe("getThreadWithReplies auth refusal mapping (TASK-015)", () => {
  it("maps a genuine token rejection to unauthenticated", async () => {
    const result = await getThreadWithReplies(
      "token",
      TEAM_ID,
      THREAD_ID,
      depsFor({ verifyToken: vi.fn().mockRejectedValue(new Error("bad token")) }),
    );

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("keeps erasure_in_progress as its own refusal, not unauthenticated", async () => {
    const result = await getThreadWithReplies("token", TEAM_ID, THREAD_ID, depsFor({ readFence: async () => ({ kind: "in_progress" as const }) }));

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
  });

  it("keeps auth_unavailable as its own refusal when the fence read fails", async () => {
    const result = await getThreadWithReplies(
      "token",
      TEAM_ID,
      THREAD_ID,
      depsFor({
        readFence: async () => {
          throw new Error("firestore unavailable");
        },
      }),
    );

    expect(result).toEqual({ ok: false, error: "auth_unavailable" });
  });
});
