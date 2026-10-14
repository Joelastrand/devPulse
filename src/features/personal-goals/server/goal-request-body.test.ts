import { describe, expect, it } from "vitest";
import { GOAL_BODY_MAX_BYTES } from "../domain/goal-constants";
import { readCreateGoalRequest, readUpdateGoalRequest } from "./goal-request-body";

const post = (body: BodyInit | null) => new Request("http://localhost/api/me/goals", { method: "POST", body });
const invalid = { ok: false, error: "invalid_request" };

describe("readCreateGoalRequest — accepted bodies (BR-22)", () => {
  it("accepts a title alone and forwards only the keys that are present", async () => {
    const result = await readCreateGoalRequest(post(JSON.stringify({ title: "Lær Rust" })));
    expect(result).toEqual({ ok: true, input: { title: "Lær Rust" } });
    expect(Object.keys((result as { input: object }).input)).toEqual(["title"]);
  });

  it("forwards treeId and targetDate unchanged, leaving their validity to the operation", async () => {
    const body = { title: "  x  ", treeId: "", targetDate: "2026-02-30" };
    expect(await readCreateGoalRequest(post(JSON.stringify(body)))).toEqual({ ok: true, input: body });
  });

  it.each(["treeId", "targetDate"])("treats a null %s as absent", async (key) => {
    const result = await readCreateGoalRequest(post(JSON.stringify({ title: "x", [key]: null })));
    expect(result).toEqual({ ok: true, input: { title: "x" } });
    expect(Object.keys((result as { input: object }).input)).toEqual(["title"]);
  });

  it("accepts a body of exactly the byte cap and counts bytes, not characters", async () => {
    const pad = (n: number) => "å".repeat(n);
    const frame = JSON.stringify({ title: "" }).length;
    // Each "å" is two bytes in UTF-8.
    const fits = JSON.stringify({ title: pad((GOAL_BODY_MAX_BYTES - frame) / 2) });
    expect(new TextEncoder().encode(fits).length).toBe(GOAL_BODY_MAX_BYTES);
    expect((await readCreateGoalRequest(post(fits))).ok).toBe(true);
    const over = JSON.stringify({ title: pad((GOAL_BODY_MAX_BYTES - frame) / 2 + 1) });
    expect(await readCreateGoalRequest(post(over))).toEqual(invalid);
  });
});

describe("readCreateGoalRequest — rejected bodies are invalid_request (BR-22, BR-23)", () => {
  it.each([
    ["uid", { title: "x", uid: "other" }],
    ["ownerUid", { title: "x", ownerUid: "other" }],
    ["teamId", { title: "x", teamId: "t" }],
    ["memberRef", { title: "x", memberRef: "m" }],
    ["email", { title: "x", email: "a@b.c" }],
    ["status", { title: "x", status: "completed" }],
    ["createdAt", { title: "x", createdAt: "2026-01-01" }],
    ["completedAt", { title: "x", completedAt: null }],
    ["areaName", { title: "x", areaName: "n" }],
    ["an arbitrary extra key", { title: "x", extra: 1 }],
  ])("rejects an unknown key: %s", async (_name, body) => {
    expect(await readCreateGoalRequest(post(JSON.stringify(body)))).toEqual(invalid);
  });

  it.each([
    ["no body", null],
    ["an empty body", ""],
    ["invalid JSON", "{title:"],
    ["null", "null"],
    ["an array", '[{"title":"x"}]'],
    ["a string", '"x"'],
    ["a number", "42"],
    ["a boolean", "true"],
    ["an empty object (title is required)", "{}"],
  ])("rejects %s", async (_name, body) => {
    expect(await readCreateGoalRequest(post(body))).toEqual(invalid);
  });

  it.each([
    ["a numeric title", { title: 5 }],
    ["a null title", { title: null }],
    ["an object title", { title: { a: 1 } }],
    ["a numeric treeId", { title: "x", treeId: 5 }],
    ["an object treeId", { title: "x", treeId: {} }],
    ["a numeric targetDate", { title: "x", targetDate: 20260101 }],
    ["a boolean targetDate", { title: "x", targetDate: false }],
  ])("rejects %s", async (_name, body) => {
    expect(await readCreateGoalRequest(post(JSON.stringify(body)))).toEqual(invalid);
  });

  it("rejects invalid UTF-8", async () => {
    expect(await readCreateGoalRequest(post(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])))).toEqual(invalid);
  });

  it("enforces the cap on the bytes actually read, whatever Content-Length claims", async () => {
    const big = JSON.stringify({ title: "x".repeat(GOAL_BODY_MAX_BYTES) });
    const request = new Request("http://localhost/api/me/goals", {
      method: "POST",
      body: big,
      headers: { "content-length": "10" },
    });
    expect(await readCreateGoalRequest(request)).toEqual(invalid);
  });

  it("stops reading a streamed body once the cap is exceeded", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024).fill(0x20));
        if (pulled > 1000) controller.close();
      },
    });
    const request = new Request("http://localhost/api/me/goals", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readCreateGoalRequest(request)).toEqual(invalid);
    expect(pulled).toBeLessThan(20);
  });

  it("does not echo any part of a rejected body", async () => {
    const result = await readCreateGoalRequest(post(JSON.stringify({ title: "SECRET-TITLE", ownerUid: "SECRET-UID" })));
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
});

const patch = (body: BodyInit | null) => new Request("http://localhost/api/me/goals/g1", { method: "PATCH", body });

describe("readUpdateGoalRequest — accepted bodies (BR-22)", () => {
  it("forwards only the keys that are present, in a partial body", async () => {
    const result = await readUpdateGoalRequest(patch(JSON.stringify({ status: "completed" })));
    expect(result).toEqual({ ok: true, input: { status: "completed" } });
    expect(Object.keys((result as { input: object }).input)).toEqual(["status"]);
  });

  it("accepts all four keys and leaves title/date validity to the operation", async () => {
    const body = { title: "  x  ", treeId: "t1", targetDate: "2026-02-30", status: "active" };
    expect(await readUpdateGoalRequest(patch(JSON.stringify(body)))).toEqual({ ok: true, input: body });
  });

  it.each(["treeId", "targetDate"])("keeps a null %s as null (remove), distinct from absent", async (key) => {
    const result = await readUpdateGoalRequest(patch(JSON.stringify({ [key]: null })));
    expect(result).toEqual({ ok: true, input: { [key]: null } });
    expect(Object.keys((result as { input: object }).input)).toEqual([key]);
  });

  it.each(["active", "completed"])("accepts status %s", async (status) => {
    expect(await readUpdateGoalRequest(patch(JSON.stringify({ status })))).toEqual({ ok: true, input: { status } });
  });

  it("accepts a body of exactly the byte cap and rejects one byte more (4096 / 4097)", async () => {
    const frame = JSON.stringify({ title: "" }).length;
    const exact = JSON.stringify({ title: "x".repeat(GOAL_BODY_MAX_BYTES - frame) });
    expect(new TextEncoder().encode(exact).length).toBe(GOAL_BODY_MAX_BYTES);
    expect((await readUpdateGoalRequest(patch(exact))).ok).toBe(true);
    const over = JSON.stringify({ title: "x".repeat(GOAL_BODY_MAX_BYTES - frame + 1) });
    expect(new TextEncoder().encode(over).length).toBe(GOAL_BODY_MAX_BYTES + 1);
    expect(await readUpdateGoalRequest(patch(over))).toEqual(invalid);
  });
});

describe("readUpdateGoalRequest — rejected bodies are invalid_request (BR-22, BR-23)", () => {
  it.each([
    ["uid", { uid: "o" }],
    ["ownerUid", { title: "x", ownerUid: "o" }],
    ["teamId", { title: "x", teamId: "t" }],
    ["email", { title: "x", email: "a@b.c" }],
    ["createdAt", { title: "x", createdAt: "2026-01-01" }],
    ["updatedAt", { title: "x", updatedAt: "2026-01-01" }],
    ["completedAt", { title: "x", completedAt: null }],
    ["areaName", { title: "x", areaName: "n" }],
    ["an arbitrary extra key", { title: "x", extra: 1 }],
  ])("rejects an unknown key: %s", async (_name, body) => {
    expect(await readUpdateGoalRequest(patch(JSON.stringify(body)))).toEqual(invalid);
  });

  it.each([
    ["no body", null],
    ["an empty body", ""],
    ["invalid JSON", "{title:"],
    ["null", "null"],
    ["an array", '[{"title":"x"}]'],
    ["a string", '"x"'],
    ["a number", "42"],
    ["an empty object (at least one key is required)", "{}"],
  ])("rejects %s", async (_name, body) => {
    expect(await readUpdateGoalRequest(patch(body))).toEqual(invalid);
  });

  it.each([
    ["a null title", { title: null }],
    ["a numeric title", { title: 5 }],
    ["an object title", { title: {} }],
    ["a numeric treeId", { treeId: 5 }],
    ["a boolean targetDate", { targetDate: false }],
    ["an unknown status", { status: "done" }],
    ["a capitalised status", { status: "Active" }],
    ["a null status", { status: null }],
    ["a numeric status", { status: 1 }],
  ])("rejects %s", async (_name, body) => {
    expect(await readUpdateGoalRequest(patch(JSON.stringify(body)))).toEqual(invalid);
  });

  it("rejects invalid UTF-8", async () => {
    expect(await readUpdateGoalRequest(patch(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])))).toEqual(invalid);
  });

  it("enforces the cap on the bytes actually read, whatever Content-Length claims", async () => {
    const big = JSON.stringify({ title: "x".repeat(GOAL_BODY_MAX_BYTES) });
    const request = new Request("http://localhost/api/me/goals/g1", {
      method: "PATCH",
      body: big,
      headers: { "content-length": "10" },
    });
    expect(await readUpdateGoalRequest(request)).toEqual(invalid);
  });

  it("does not echo any part of a rejected body", async () => {
    const result = await readUpdateGoalRequest(patch(JSON.stringify({ title: "SECRET-TITLE", ownerUid: "SECRET-UID" })));
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
});

describe("readCreateGoalRequest — exact byte boundary", () => {
  it("accepts 4096 bytes and rejects 4097 bytes", async () => {
    const frame = JSON.stringify({ title: "" }).length;
    const exact = JSON.stringify({ title: "x".repeat(GOAL_BODY_MAX_BYTES - frame) });
    expect((await readCreateGoalRequest(post(exact))).ok).toBe(true);
    const over = JSON.stringify({ title: "x".repeat(GOAL_BODY_MAX_BYTES - frame + 1) });
    expect(await readCreateGoalRequest(post(over))).toEqual(invalid);
  });
});
