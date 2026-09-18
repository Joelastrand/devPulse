import { describe, expect, it, vi } from "vitest";
import type {
  CreateReplyGateway,
  CreateThreadGateway,
  DeleteReplyGateway,
  DeleteThreadGateway,
  ForumManagementActionResult,
  ForumThreadsReadGateway,
  ThreadDetailReadGateway,
} from "./forum-gateway";
import {
  createReply,
  createThread,
  deleteReply,
  deleteThread,
  fetchTeamThreads,
  fetchThreadDetail,
} from "./forum-gateway";

describe("fetchTeamThreads", () => {
  it("delegates to the injected gateway", async () => {
    const expected = { status: "ok" as const, threads: [] };
    const gateway: ForumThreadsReadGateway = { fetchTeamThreads: vi.fn(async () => expected) };

    const result = await fetchTeamThreads("token", "team-1", { gateway });

    expect(gateway.fetchTeamThreads).toHaveBeenCalledWith("token", "team-1");
    expect(result).toEqual(expected);
  });
});

describe("fetchTeamThreads default gateway", () => {
  function stubFetch(status: number, body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );
  }

  it("rebuilds a well-formed thread list", async () => {
    stubFetch(200, {
      status: "ok",
      threads: [
        { threadId: "t1", title: "Tittel", authorTag: "48D73D", isOwnThread: true, createdAt: "2026-01-10T10:00:00.000Z" },
      ],
    });

    const result = await fetchTeamThreads("token", "team-1");

    expect(result).toEqual({
      status: "ok",
      threads: [
        { threadId: "t1", title: "Tittel", authorTag: "48D73D", isOwnThread: true, createdAt: "2026-01-10T10:00:00.000Z" },
      ],
    });
  });

  it("strips an extra authorUid/ciphertext/email-shaped field from a raw item instead of passing it through", async () => {
    stubFetch(200, {
      status: "ok",
      threads: [
        {
          threadId: "t1",
          title: "Tittel",
          authorTag: "48D73D",
          isOwnThread: true,
          createdAt: "2026-01-10T10:00:00.000Z",
          authorUid: "leaked-uid",
          ciphertext: "leaked-ciphertext",
          email: "leaked@example.com",
        },
      ],
    });

    const result = await fetchTeamThreads("token", "team-1");

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(Object.keys(result.threads[0])).toEqual(["threadId", "title", "authorTag", "isOwnThread", "createdAt"]);
    }
  });

  it("rejects a malformed item as read_failed rather than dropping it silently", async () => {
    stubFetch(200, { status: "ok", threads: [{ threadId: "t1" }] });

    const result = await fetchTeamThreads("token", "team-1");

    expect(result).toEqual({ status: "read_failed" });
  });

  it("rejects a non-array threads field as read_failed", async () => {
    stubFetch(200, { status: "ok", threads: "not-an-array" });

    const result = await fetchTeamThreads("token", "team-1");

    expect(result).toEqual({ status: "read_failed" });
  });

  it("passes through a known error status", async () => {
    stubFetch(403, { status: "forbidden" });

    const result = await fetchTeamThreads("token", "team-1");

    expect(result).toEqual({ status: "forbidden" });
  });

  it("maps an unrecognized status to read_failed", async () => {
    stubFetch(418, { status: "teapot" });

    const result = await fetchTeamThreads("token", "team-1");

    expect(result).toEqual({ status: "read_failed" });
  });

  it("maps a network failure to read_failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const result = await fetchTeamThreads("token", "team-1");

    expect(result).toEqual({ status: "read_failed" });
  });
});

describe("createThread", () => {
  it("delegates to the injected gateway", async () => {
    const expected = { status: "ok" as const, threadId: "t1" };
    const gateway: CreateThreadGateway = { createThread: vi.fn(async () => expected) };

    const result = await createThread("token", "team-1", "Tittel", "Body", { gateway });

    expect(gateway.createThread).toHaveBeenCalledWith("token", "team-1", "Tittel", "Body");
    expect(result).toEqual(expected);
  });
});

describe("createThread default gateway", () => {
  it("sends only title/body — never an identity/scope/lifecycle field", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, threadId: "t1" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createThread("token", "team-1", "Tittel", "Body");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ title: "Tittel", body: "Body" });
  });

  it("returns the generated threadId on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, threadId: "t1" }), { status: 201 })),
    );

    const result = await createThread("token", "team-1", "Tittel", "Body");

    expect(result).toEqual({ status: "ok", threadId: "t1" });
  });

  it("maps a known error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "team_disabled" }), { status: 400 })),
    );

    const result = await createThread("token", "team-1", "Tittel", "Body");

    expect(result).toEqual({ status: "team_disabled" });
  });
});

describe("fetchThreadDetail", () => {
  it("delegates to the injected gateway", async () => {
    const expected = {
      status: "ok" as const,
      thread: {
        threadId: "t1",
        title: "T",
        body: "B",
        authorTag: "48D73D",
        isOwnThread: true,
        createdAt: "2026-01-10T10:00:00.000Z",
      },
      replies: [],
    };
    const gateway: ThreadDetailReadGateway = { fetchThreadDetail: vi.fn(async () => expected) };

    const result = await fetchThreadDetail("token", "team-1", "t1", { gateway });

    expect(gateway.fetchThreadDetail).toHaveBeenCalledWith("token", "team-1", "t1");
    expect(result).toEqual(expected);
  });
});

describe("fetchThreadDetail default gateway", () => {
  function stubFetch(status: number, body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );
  }

  it("rebuilds a thread with an active and a tombstoned reply", async () => {
    stubFetch(200, {
      status: "ok",
      thread: {
        threadId: "t1",
        title: "T",
        body: "B",
        authorTag: "48D73D",
        isOwnThread: true,
        createdAt: "2026-01-10T10:00:00.000Z",
      },
      replies: [
        { replyId: "r1", isDeleted: false, body: "Svar", authorTag: "AA11BB", isOwnReply: false, createdAt: "2026-01-10T11:00:00.000Z" },
        { replyId: "r2", isDeleted: true, body: null, authorTag: null, isOwnReply: false, createdAt: "2026-01-10T12:00:00.000Z" },
      ],
    });

    const result = await fetchThreadDetail("token", "team-1", "t1");

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.replies).toHaveLength(2);
      expect(result.replies[1]).toEqual({
        replyId: "r2",
        isDeleted: true,
        body: null,
        authorTag: null,
        isOwnReply: false,
        createdAt: "2026-01-10T12:00:00.000Z",
      });
    }
  });

  it("strips an extra authorUid/deletedBy/ciphertext field from a raw reply item", async () => {
    stubFetch(200, {
      status: "ok",
      thread: {
        threadId: "t1",
        title: "T",
        body: "B",
        authorTag: "48D73D",
        isOwnThread: true,
        createdAt: "2026-01-10T10:00:00.000Z",
      },
      replies: [
        {
          replyId: "r1",
          isDeleted: false,
          body: "Svar",
          authorTag: "AA11BB",
          isOwnReply: false,
          createdAt: "2026-01-10T11:00:00.000Z",
          authorUid: "leaked-uid",
          deletedBy: "leaked-deleter",
          ciphertext: "leaked",
        },
      ],
    });

    const result = await fetchThreadDetail("token", "team-1", "t1");

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(Object.keys(result.replies[0])).toEqual([
        "replyId",
        "isDeleted",
        "body",
        "authorTag",
        "isOwnReply",
        "createdAt",
      ]);
    }
  });

  it("rejects a reply carrying fields from both the active and tombstone shapes as read_failed", async () => {
    stubFetch(200, {
      status: "ok",
      thread: {
        threadId: "t1",
        title: "T",
        body: "B",
        authorTag: "48D73D",
        isOwnThread: true,
        createdAt: "2026-01-10T10:00:00.000Z",
      },
      replies: [
        { replyId: "r1", isDeleted: true, body: "leaked plaintext", authorTag: "AA11BB", isOwnReply: false, createdAt: "2026-01-10T11:00:00.000Z" },
      ],
    });

    const result = await fetchThreadDetail("token", "team-1", "t1");

    expect(result).toEqual({ status: "read_failed" });
  });

  it("passes through not_found", async () => {
    stubFetch(404, { status: "not_found" });

    const result = await fetchThreadDetail("token", "team-1", "t1");

    expect(result).toEqual({ status: "not_found" });
  });
});

describe("createReply", () => {
  it("delegates to the injected gateway", async () => {
    const expected = { status: "ok" as const };
    const gateway: CreateReplyGateway = { createReply: vi.fn(async () => expected) };

    const result = await createReply("token", "team-1", "t1", "Svar", { gateway });

    expect(gateway.createReply).toHaveBeenCalledWith("token", "team-1", "t1", "Svar");
    expect(result).toEqual(expected);
  });
});

describe("createReply default gateway", () => {
  it("sends only the body field", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await createReply("token", "team-1", "t1", "Svar-tekst");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ body: "Svar-tekst" });
  });

  it("maps thread_full", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "thread_full" }), { status: 400 })),
    );

    const result = await createReply("token", "team-1", "t1", "Svar-tekst");

    expect(result).toEqual({ status: "thread_full" });
  });
});

describe("deleteThread", () => {
  it("delegates to the injected gateway", async () => {
    const gateway: DeleteThreadGateway = {
      deleteThread: vi.fn(async (): Promise<ForumManagementActionResult> => ({ ok: true })),
    };

    const result = await deleteThread("token", "team-1", "t1", { gateway });

    expect(gateway.deleteThread).toHaveBeenCalledWith("token", "team-1", "t1");
    expect(result).toEqual({ ok: true });
  });
});

describe("deleteThread default gateway", () => {
  it("issues a DELETE with no request body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteThread("token", "team-1", "t1");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it("maps not_found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 })));

    const result = await deleteThread("token", "team-1", "t1");

    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});

describe("deleteReply", () => {
  it("delegates to the injected gateway", async () => {
    const gateway: DeleteReplyGateway = {
      deleteReply: vi.fn(async (): Promise<ForumManagementActionResult> => ({ ok: true })),
    };

    const result = await deleteReply("token", "team-1", "t1", "r1", { gateway });

    expect(gateway.deleteReply).toHaveBeenCalledWith("token", "team-1", "t1", "r1");
    expect(result).toEqual({ ok: true });
  });

  it("treats a retry against an already-tombstoned reply as ok:true, same as the first call", async () => {
    const gateway: DeleteReplyGateway = {
      deleteReply: vi.fn(async (): Promise<ForumManagementActionResult> => ({ ok: true })),
    };

    const first = await deleteReply("token", "team-1", "t1", "r1", { gateway });
    const second = await deleteReply("token", "team-1", "t1", "r1", { gateway });

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
  });
});
