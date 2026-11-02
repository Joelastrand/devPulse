import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { deleteConversation, deleteConversationForErasure } from "./delete-conversation";
import { issueErasureOwnerCleanupCapability, type ErasureOwnerCleanupCapability } from "./erasure-owner-cleanup-capability";
import type { ConversationStore } from "./conversation-store-types";
import { createFakeConversationStore } from "./fake-conversation-store";
import { createFakeContentCodec } from "./fake-content-codec";
import { OWNER_UID, PARTICIPANT_UID, rosterTeam, seedOwnerConversation } from "./owner-read-test-support";

// TASK-038 decision (2026-11-02): the caller-controlled `unfenced` option is gone. Only a capability minted by the erasure's
// owner cleanup can delete unfenced. Fixtures are synthetic.

const CONVERSATION_ID = "conv-boundary-1";
const REPO_SRC = join(process.cwd(), "src");
const REPO_APP = join(process.cwd(), "app");
const REFUSED = { ok: false, error: "erasure_in_progress" };

async function erasingOwner(): Promise<ConversationStore> {
  const store = createFakeConversationStore({ erasingUids: [OWNER_UID], teams: rosterTeam([OWNER_UID, PARTICIPANT_UID]) });
  await seedOwnerConversation(store, createFakeContentCodec(), {
    conversationId: CONVERSATION_ID,
    title: "Synthetic title",
    participant: { uid: PARTICIPANT_UID, state: "accepted" },
  });
  return store;
}

describe("ordinary deleteConversation: no way to request an unfenced delete", () => {
  it("has no unfenced option in its type: the options object is checked by the compiler", async () => {
    const store = await erasingOwner();
    // @ts-expect-error the caller-controlled unfenced option was removed (TASK-038, 2026-11-02); typecheck fails if it returns
    const typed = deleteConversation(OWNER_UID, CONVERSATION_ID, { store, unfenced: true });

    expect(await typed).toEqual(REFUSED);
  });

  it("refuses during erasure even when a caller passes the removed unfenced flag", async () => {
    const store = await erasingOwner();
    const legacyOptions = { store, unfenced: true } as unknown as Parameters<typeof deleteConversation>[2];

    expect(await deleteConversation(OWNER_UID, CONVERSATION_ID, legacyOptions)).toEqual(REFUSED);
    expect(await store.getOwner(OWNER_UID, CONVERSATION_ID)).toBeDefined();
  });

  it("refuses during erasure through the owner fence, whatever the options object carries", async () => {
    const store = await erasingOwner();
    const spreadOptions = { ...{ store }, unfenced: true } as unknown as Parameters<typeof deleteConversation>[2];

    expect(await deleteConversation(OWNER_UID, CONVERSATION_ID, spreadOptions)).toEqual(REFUSED);
    expect(await store.getOwner(OWNER_UID, CONVERSATION_ID)).toBeDefined();
  });
});

describe("erasure owner delete: capability required", () => {
  it("refuses a forged capability before any read or write", async () => {
    const store = await erasingOwner();
    const forged = {} as unknown as ErasureOwnerCleanupCapability;

    expect(await deleteConversationForErasure(forged, OWNER_UID, CONVERSATION_ID, store)).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await store.getOwner(OWNER_UID, CONVERSATION_ID)).toBeDefined();
  });

  it("refuses a boolean in place of the capability", async () => {
    const store = await erasingOwner();

    const result = await deleteConversationForErasure(true as unknown as ErasureOwnerCleanupCapability, OWNER_UID, CONVERSATION_ID, store);

    expect(result.ok).toBe(false);
    expect(await store.getOwner(OWNER_UID, CONVERSATION_ID)).toBeDefined();
  });

  it("accepts the minted capability and deletes unfenced, with the TASK-019 erasure-only path unchanged", async () => {
    const store = await erasingOwner();

    expect(await deleteConversationForErasure(issueErasureOwnerCleanupCapability(), OWNER_UID, CONVERSATION_ID, store)).toEqual({
      ok: true,
    });
    expect(await store.getOwner(OWNER_UID, CONVERSATION_ID)).toBeUndefined();
  });
});

describe("static boundary: the unfenced option and the capability issuer stay closed", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });
  }
  const sources = [...walk(REPO_SRC), ...walk(REPO_APP)].map((full) => ({
    path: relative(process.cwd(), full).split(sep).join("/"),
    text: readFileSync(full, "utf8"),
  }));

  it("no production source has an unfenced option on deleteConversation", () => {
    const deleteSource = sources.find((s) => s.path === "src/features/development-conversations/server/delete-conversation.ts");
    expect(deleteSource?.text).toBeDefined();
    expect(deleteSource?.text).not.toMatch(/unfenced/);
  });

  // The three approved minters: the owner delete and locator cleanup, the erasure binding step, and ordinary removal's binding
  // cleanup (the 2026-11-02 lifecycle decision). Exact modules; a new minter is a reviewed change to this list.
  const APPROVED_MINTERS = [
    "src/features/account-erasure/server/conversations-erasure.ts",
    "src/features/account-erasure/server/membership-destruction-adapter.ts",
    "src/features/account-erasure/server/production-erasure-handlers.ts",
    "src/features/development-conversations/server/erasure-owner-cleanup-capability.ts",
  ];

  it("only the three approved erasure modules mint the owner-cleanup capability", () => {
    const minters = sources
      .filter((s) => /issueErasureOwnerCleanupCapability\s*\(/.test(s.text))
      .map((s) => s.path)
      .sort();
    expect(minters).toEqual(APPROVED_MINTERS);
  });

  it("the capability is imported outside the D2 module only by the approved erasure modules (type-only importers cannot mint)", () => {
    const importers = sources
      .filter((s) => s.text.includes("erasure-owner-cleanup-capability") && !s.path.includes("development-conversations/server/"))
      .map((s) => s.path)
      .sort();
    expect(importers).toEqual(
      [
        "src/features/account-erasure/server/conversations-erasure.ts",
        "src/features/account-erasure/server/membership-destruction-adapter.ts",
        `src/features/account-erasure/server/participant-bindings${"-erasure.ts"}`,
        "src/features/account-erasure/server/production-erasure-handlers.ts",
      ].sort(),
    );
  });

  it("only the approved erasure modules call the erasure-only transaction", () => {
    const callers = sources
      .filter((s) => /\.runErasureCleanupTransaction\s*\(/.test(s.text))
      .map((s) => s.path)
      .sort();
    expect(callers).toEqual([
      "src/features/account-erasure/server/conversations-erasure.ts",
      `src/features/account-erasure/server/participant-bindings${"-erasure.ts"}`,
      "src/features/development-conversations/server/delete-conversation.ts",
    ]);
  });

  it("the production store and its interface declare no generic, unfenced transaction", () => {
    const store = sources.find((s) => s.path === "src/features/development-conversations/server/conversation-store.ts");
    const types = sources.find((s) => s.path === "src/features/development-conversations/server/conversation-store-types.ts");
    expect(store?.text).toBeDefined();
    expect(types?.text).toBeDefined();
    expect(store?.text).not.toMatch(/^\s+runTransaction\s*[<(]/m);
    expect(types?.text).not.toMatch(/\brunTransaction\s*[<(:]/);
    expect(types?.text).toMatch(/runErasureCleanupTransaction</);
  });
});
