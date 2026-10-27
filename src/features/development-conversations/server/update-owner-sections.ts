import "server-only";
import { isConversationId } from "../domain/conversation-id";
import type { ConversationContent } from "../domain/content-payload";
import { isPlainObject } from "../domain/stored-shape";
import { normalizePlannedFor } from "../domain/plan-date";
import { normalizeNextSteps, normalizeNote, normalizeTitle } from "../domain/text-rules";
import {
  decryptForClassification as decryptForClassificationWithKey,
  encodeContent as encodeContentWithKey,
  probeKey as probeKeyOnce,
  type EncodeContentResult,
} from "./content-codec";
import { getDefaultConversationStore } from "./conversation-store";
import type { ConversationStore, OwnerDocumentPatch } from "./conversation-store-types";
import { classifyOwnerDocument, type OwnerReadCodec } from "./owner-read";

/**
 * Owner section writes (SPEC BR-6, BR-19, BR-28, BR-39, BR-49, D2-SI-7, IMPL-1; TASK-012). The owner rewrites `title`,
 * `plannedFor`, `ownerNotes` and `nextSteps` while the conversation is `open`. The write decrypts the whole payload, replaces
 * only the supplied owner fields, and re-encrypts it, so `participantNotes` and `sharedGoals` keep their stored values.
 * The owner uid is the first argument and is never read from the input.
 */

/** The codec operations a section write needs: the classifier's decrypt seam, the probe and the encoder. */
export interface UpdateOwnerSectionsCodec extends OwnerReadCodec {
  encodeContent(content: ConversationContent): EncodeContentResult;
}

export interface UpdateOwnerSectionsDeps {
  store: ConversationStore;
  codec: UpdateOwnerSectionsCodec;
  /** Server time for `updatedAt` (BR-2 pattern). Injected so tests can fix it. */
  clock: () => Date;
}

/** Fields this task writes. Each other owner key belongs to a later task and is refused here. */
export type OwnerSectionField = "title" | "plannedFor" | "ownerNotes" | "nextSteps";

/**
 * A field name is returned only for the keys that belong to other tasks. Any other key is reported as `unknown`, so an
 * arbitrary request key is never echoed back.
 */
export type OwnerSectionRejectedField = "sharedGoalIds" | "participantMemberRef" | "status";

export type UpdateOwnerSectionsResult =
  | { ok: true }
  | { ok: false; error: "invalid_input"; field: OwnerSectionField | OwnerSectionRejectedField | "unknown" | "patch" }
  | { ok: false; error: "conversation_not_found" | "conversation_completed" | "persistence_failed" };

const NOT_FOUND: UpdateOwnerSectionsResult = { ok: false, error: "conversation_not_found" };
const FAILED: UpdateOwnerSectionsResult = { ok: false, error: "persistence_failed" };

const OWNER_SECTION_FIELDS: readonly OwnerSectionField[] = ["title", "plannedFor", "ownerNotes", "nextSteps"];
const REJECTED_FIELDS: readonly OwnerSectionRejectedField[] = ["sharedGoalIds", "participantMemberRef", "status"];

/** The validated fields that the patch supplies. An absent key is `undefined`, never written. */
interface SectionFields {
  title?: string;
  plannedFor?: string | null;
  ownerNotes?: string;
  nextSteps?: string[];
}

type ParsePatchResult = { ok: true; fields: SectionFields } | { ok: false; field: OwnerSectionRejectedField | OwnerSectionField | "unknown" | "patch" };

/** Validates the patch before any read. Only supplied keys are checked, and each rule is the TASK-001 rule. */
function parseSectionPatch(input: unknown): ParsePatchResult {
  if (!isPlainObject(input)) return { ok: false, field: "patch" };

  const suppliedKeys = Object.keys(input).filter((key) => input[key] !== undefined);
  for (const key of suppliedKeys) {
    if (!isOwnerSectionField(key)) {
      return { ok: false, field: isRejectedField(key) ? key : "unknown" };
    }
  }
  if (suppliedKeys.length === 0) return { ok: false, field: "patch" };

  const fields: SectionFields = {};
  if (input.title !== undefined) {
    const title = normalizeTitle(input.title);
    if (!title.ok) return { ok: false, field: "title" };
    fields.title = title.text;
  }
  if (input.plannedFor !== undefined) {
    const plannedFor = normalizePlannedFor(input.plannedFor);
    if (!plannedFor.ok) return { ok: false, field: "plannedFor" };
    fields.plannedFor = plannedFor.value;
  }
  if (input.ownerNotes !== undefined) {
    const notes = normalizeNote(input.ownerNotes);
    if (!notes.ok) return { ok: false, field: "ownerNotes" };
    fields.ownerNotes = notes.text;
  }
  if (input.nextSteps !== undefined) {
    const steps = normalizeNextSteps(input.nextSteps);
    if (!steps.ok) return { ok: false, field: "nextSteps" };
    fields.nextSteps = steps.items;
  }
  return { ok: true, fields };
}

function isOwnerSectionField(key: string): key is OwnerSectionField {
  return (OWNER_SECTION_FIELDS as readonly string[]).includes(key);
}

function isRejectedField(key: string): key is OwnerSectionRejectedField {
  return (REJECTED_FIELDS as readonly string[]).includes(key);
}

function defaultDeps(): UpdateOwnerSectionsDeps {
  return {
    store: getDefaultConversationStore(),
    codec: { probeKey: probeKeyOnce, decryptForClassification: decryptForClassificationWithKey, encodeContent: encodeContentWithKey },
    clock: () => new Date(),
  };
}

export async function updateOwnerSections(
  ownerUid: string,
  conversationId: string,
  input: unknown,
  deps: UpdateOwnerSectionsDeps = defaultDeps(),
): Promise<UpdateOwnerSectionsResult> {
  const parsed = parseSectionPatch(input);
  if (!parsed.ok) return { ok: false, error: "invalid_input", field: parsed.field };

  // A malformed id cannot name a document, so it is refused before any read (D2-SI-15).
  if (!isConversationId(conversationId)) return NOT_FOUND;
  // BR-53: the key probe runs before any document is read or written.
  if (!deps.codec.probeKey().ok) return FAILED;

  const now = deps.clock();
  const { fields } = parsed;
  try {
    return await deps.store.runTransaction(async (tx): Promise<UpdateOwnerSectionsResult> => {
      const raw = await tx.getOwner(ownerUid, conversationId);
      if (raw === undefined) return NOT_FOUND;

      // IMPL-1: the rewrite needs the decrypted payload. A key failure throws out of the classifier and is caught below.
      const classification = classifyOwnerDocument(raw, deps.codec);
      if (classification.kind !== "valid") return NOT_FOUND;
      const record = classification.record;

      // BR-28: a completed conversation freezes every key this task writes.
      if (record.status === "completed") return { ok: false, error: "conversation_completed" };

      // Only the supplied owner fields change. `participantNotes` and `sharedGoals` are carried over unchanged (BR-49).
      const content: ConversationContent = {
        title: fields.title ?? record.content.title,
        ownerNotes: fields.ownerNotes ?? record.content.ownerNotes,
        nextSteps: fields.nextSteps ?? record.content.nextSteps,
        participantNotes: record.content.participantNotes,
        sharedGoals: record.content.sharedGoals,
      };
      const encoded = deps.codec.encodeContent(content);
      if (!encoded.ok) return FAILED;

      // `plannedFor` is a plain field, so it is patched directly. A `null` value clears it (BR-6).
      const patch: OwnerDocumentPatch = {
        ...(fields.plannedFor !== undefined ? { plannedFor: fields.plannedFor } : {}),
        updatedAt: new Date(now.getTime()),
        ...encoded.content,
      };
      tx.updateOwner(ownerUid, conversationId, patch);
      return { ok: true };
    });
  } catch {
    // Any read, key or write failure is operational. The raw error is never surfaced (BR-47).
    return FAILED;
  }
}
