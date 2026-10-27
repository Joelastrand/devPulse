import { describe, expect, it } from "vitest";
import type { ConversationContent } from "../domain/content-payload";
import { createFakeContentCodec } from "./fake-content-codec";

/** Synthetic test data only (invariant 15). */
const CONTENT: ConversationContent = {
  title: "Synthetic fake title",
  ownerNotes: "Synthetic fake notes",
  nextSteps: [],
  participantNotes: "",
  sharedGoals: [],
};

/** A handle that was never stored, which the fake treats as tampering. */
function unknownHandle(): string {
  return Buffer.from("fake-handle-that-was-never-stored", "utf8").toString("base64");
}

describe("fake content codec", () => {
  it("round-trips content deterministically without key material", () => {
    const codec = createFakeContentCodec();
    const encoded = codec.encodeContent(CONTENT);

    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(codec.decodeContent(encoded.content)).toEqual({ ok: true, content: CONTENT });
  });

  it("stores no readable content in the envelope", () => {
    const codec = createFakeContentCodec();
    const encoded = codec.encodeContent(CONTENT);

    expect(JSON.stringify(encoded)).not.toContain(CONTENT.title);
    expect(JSON.stringify(encoded)).not.toContain(CONTENT.ownerNotes);
  });

  it("writes structurally valid envelope fields (TASK-002 lengths)", () => {
    const codec = createFakeContentCodec();
    const encoded = codec.encodeContent(CONTENT);

    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(Buffer.from(encoded.content.iv, "base64").length).toBe(12);
    expect(Buffer.from(encoded.content.authTag, "base64").length).toBe(16);
    expect(Buffer.from(encoded.content.keyCheck, "base64").length).toBe(32);
    expect(encoded.content.keyVersion).toBe("v1");
  });

  it("treats an unknown handle as payload_unauthenticated, never as a key failure", () => {
    const codec = createFakeContentCodec();
    const encoded = codec.encodeContent(CONTENT);

    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(codec.decodeContent({ ...encoded.content, ciphertext: unknownHandle() })).toEqual({
      ok: false,
      error: "payload_unauthenticated",
    });
  });

  it("simulates key_unavailable and key_mismatch for operation tests, and can be restored", () => {
    const codec = createFakeContentCodec();
    const encoded = codec.encodeContent(CONTENT);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    codec.setKeyFailure("key_unavailable");
    expect(codec.probeKey()).toEqual({ ok: false, error: "key_unavailable" });
    expect(codec.encodeContent(CONTENT)).toEqual({ ok: false, error: "key_unavailable" });
    expect(codec.decodeContent(encoded.content)).toEqual({ ok: false, error: "key_unavailable" });

    codec.setKeyFailure("key_mismatch");
    expect(codec.decodeContent(encoded.content)).toEqual({ ok: false, error: "key_mismatch" });
    expect(() => codec.decryptForClassification(encoded.content)).toThrow("key_mismatch");

    codec.setKeyFailure(null);
    expect(codec.probeKey()).toEqual({ ok: true });
    expect(codec.decodeContent(encoded.content)).toEqual({ ok: true, content: CONTENT });
  });
});
