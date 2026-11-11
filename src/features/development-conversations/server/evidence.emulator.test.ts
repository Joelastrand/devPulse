import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createResponsibility,
  deleteResponsibility,
  productionPersonalRecordDeps,
  type PersonalRecordDeps,
} from "../../personal-role-workspace/server/record-operations";
import { decodeContent, decryptForClassification, encodeContent, probeKey } from "./content-codec";
import { getDefaultConversationStore } from "./conversation-store";
import { productionOwnedEvidenceReader } from "./owned-evidence-seam";
import { setSharedEvidence, type SetSharedEvidenceDeps } from "./set-shared-evidence";
import { deleteConversation } from "./delete-conversation";
import type { RawConversationData } from "./conversation-store-types";
import type { StoredEnvelope } from "../domain/stored-owner-conversation";

/**
 * Evidence selection on the Firestore EMULATOR (SPEC BR-40 to BR-50, BR-70; SECURITY-REVIEW §11.2, W-21). The production
 * conversation store, the production personal record store, the production codec and `firestore.rules` run here. Runs only with
 * `FIRESTORE_EMULATOR_HOST` and a `demo-` project id, like the other emulator suites. Skipped otherwise. Synthetic fixtures only.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = process.env.DEVPULSE_EMULATOR_PROJECT;
const CONFIGURED =
  typeof EMULATOR_HOST === "string" && EMULATOR_HOST.length > 0 && typeof PROJECT_ID === "string" && PROJECT_ID.startsWith("demo-");

const KEY = Buffer.alloc(32, 9).toString("base64");
const OWNER = "emu-evd-owner";
const OTHER = "emu-evd-other";
const CONVERSATION_ID = "emu-evd-conv-1";
/** The fixture document is written with `updatedAt` = 2026-10-01T08:00:00.000Z (E-1 version). */
const FIXTURE_VERSION = "2026-10-01T08:00:00.000Z";
const SECRET_TITLE = "Syntetisk ansvarstittel for evidens";
const SECRET_DESCRIPTION = "Syntetisk beskrivelse for evidens";

/** The envelope fields of a stored owner document. Firestore types them as unknown, so the cast is checked by the decoder. */
const envelopeOf = (raw: RawConversationData) => ({ ciphertext: raw.ciphertext, iv: raw.iv, authTag: raw.authTag, keyVersion: raw.keyVersion, keyCheck: raw.keyCheck }) as StoredEnvelope;

describe.skipIf(!CONFIGURED)("evidence selection on the Firestore emulator (BR-40 to BR-50, BR-70, W-21)", () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalProject = process.env.FIREBASE_PROJECT_ID;
  let personal: PersonalRecordDeps;
  let responsibilityId = "";

  const conversationDeps = (): SetSharedEvidenceDeps => ({
    store: getDefaultConversationStore(),
    codec: { probeKey, decryptForClassification, encodeContent },
    reader: productionOwnedEvidenceReader(),
    clock: () => new Date(),
  });

  beforeAll(async () => {
    process.env.FIREBASE_PROJECT_ID = `${PROJECT_ID}-evd`;
    process.env.ENCRYPTION_KEY = KEY;
    personal = productionPersonalRecordDeps();

    const encoded = encodeContent({
      title: "Synthetic conversation",
      ownerNotes: "",
      nextSteps: [],
      participantNotes: "",
      sharedGoals: [],
      sharedEvidence: [],
    });
    if (!encoded.ok) throw new Error("fixture key unavailable");
    const now = new Date("2026-10-01T08:00:00.000Z");
    await getDefaultConversationStore().runOwnerTransaction(OWNER, async (tx) => {
      tx.createOwner(OWNER, CONVERSATION_ID, {
        teamId: "emu-team",
        participantUid: null,
        participantMemberRef: null,
        participantState: null,
        participantInvitedAt: null,
        participantAcceptedAt: null,
        plannedFor: null,
        status: "open",
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        ...encoded.content,
      });
    });

    const created = await createResponsibility(
      OWNER,
      { title: SECRET_TITLE, description: SECRET_DESCRIPTION, status: "active", relationToRole: "within", startDate: null, endDate: null, goalIds: [] },
      personal,
    );
    if (!created.ok) throw new Error("setup failed");
    responsibilityId = String(created.dto.id);
  });

  afterAll(async () => {
    if (responsibilityId !== "") await deleteResponsibility(OWNER, responsibilityId, personal);
    await deleteConversation(OWNER, CONVERSATION_ID);
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    if (originalProject === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = originalProject;
  });

  it("stores the selected snapshot only inside the encrypted payload, with no plaintext and no source id", async () => {
    const result = await setSharedEvidence(OWNER, CONVERSATION_ID, { responsibilityIds: [responsibilityId], achievementIds: [] }, FIXTURE_VERSION, conversationDeps());
    expect(result).toEqual({ ok: true });

    const raw = await getDefaultConversationStore().getOwner(OWNER, CONVERSATION_ID);
    if (raw === undefined) throw new Error("conversation missing");
    const stored = JSON.stringify(raw);
    expect(stored).not.toContain(SECRET_TITLE);
    expect(stored).not.toContain(SECRET_DESCRIPTION);
    expect(stored).not.toContain("sharedEvidence");
    expect(stored).not.toContain(responsibilityId);

    const decoded = decodeContent(envelopeOf(raw));
    expect(decoded.ok && decoded.content.sharedEvidence.map((item) => item.title)).toEqual([SECRET_TITLE]);
    expect(decoded.ok && Object.keys(decoded.content.sharedEvidence[0] ?? {}).sort()).toEqual(
      ["capturedAt", "description", "kind", "period", "relationToRole", "status", "title"],
    );
  });

  it("refuses a stale clear from the fixture version after a newer write, and keeps the stored set (E-1)", async () => {
    const result = await setSharedEvidence(OWNER, CONVERSATION_ID, { responsibilityIds: [], achievementIds: [] }, FIXTURE_VERSION, conversationDeps());

    expect(result).toEqual({ ok: false, error: "conversation_changed" });
    const raw = await getDefaultConversationStore().getOwner(OWNER, CONVERSATION_ID);
    if (raw === undefined) throw new Error("conversation missing");
    const decoded = decodeContent(envelopeOf(raw));
    expect(decoded.ok && decoded.content.sharedEvidence.map((item) => item.title)).toEqual([SECRET_TITLE]);
  });

  it("keeps the snapshot after the source record is deleted (BR-70)", async () => {
    expect(await deleteResponsibility(OWNER, responsibilityId, personal)).toEqual({ ok: true });

    const raw = await getDefaultConversationStore().getOwner(OWNER, CONVERSATION_ID);
    if (raw === undefined) throw new Error("conversation missing");
    const decoded = decodeContent(envelopeOf(raw));
    expect(decoded.ok && decoded.content.sharedEvidence.map((item) => item.title)).toEqual([SECRET_TITLE]);
  });

  it("answers another user with conversation_not_found for the same conversation id, and writes nothing", async () => {
    const before = await getDefaultConversationStore().getOwner(OWNER, CONVERSATION_ID);
    const result = await setSharedEvidence(OTHER, CONVERSATION_ID, { responsibilityIds: [], achievementIds: [] }, FIXTURE_VERSION, conversationDeps());

    expect(result).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await getDefaultConversationStore().getOwner(OWNER, CONVERSATION_ID)).toEqual(before);
  });
});
