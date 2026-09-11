import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../domain/app-admin";
import { normalizeEmail } from "../domain/normalize-email";
import { invitationDocId, readInvitationStatusFor } from "../domain/team-invitation";
import { requireAppAdmin } from "./require-app-admin";

const INVITATIONS_COLLECTION = "teamInvitations";

export interface CancelInvitationCollection {
  /** Raw `teamInvitations/{teamId}__{email}` document data, or `undefined` if it doesn't exist. */
  get(teamId: string, email: string): Promise<unknown>;
  markCanceled(teamId: string, email: string, now: Date): Promise<void>;
}

function getDefaultCollection(): CancelInvitationCollection {
  return {
    async get(teamId, email) {
      const snapshot = await getFirestoreDb()
        .collection(INVITATIONS_COLLECTION)
        .doc(invitationDocId(teamId, email))
        .get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async markCanceled(teamId, email, now) {
      await getFirestoreDb()
        .collection(INVITATIONS_COLLECTION)
        .doc(invitationDocId(teamId, email))
        .update({ status: "canceled", updatedAt: now });
    },
  };
}

export type CancelInvitationResult =
  | { ok: true }
  | {
      ok: false;
      error: "unauthenticated" | "forbidden" | "invalid_email" | "persistence_failed";
    };

export interface CancelInvitationDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  collection?: CancelInvitationCollection;
}

/**
 * Cancels a pending invitation (docs/features/team-management/SPEC.md —
 * BR-21). Only an app admin may call this successfully. Idempotent: a
 * missing invitation, or one that is already `"accepted"`/`"canceled"`,
 * succeeds as a no-op rather than erroring — there is nothing left to
 * cancel. Once canceled, an invitation is never subsequently auto-resolved
 * into membership by `resolve-invitations.ts`, even if a matching verified
 * email is later seen, because resolution only ever looks at `"pending"`
 * invitations.
 */
export async function cancelInvitation(
  idToken: string,
  teamId: string,
  emailInput: unknown,
  deps: CancelInvitationDeps = {},
): Promise<CancelInvitationResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  if (typeof emailInput !== "string") {
    return { ok: false, error: "invalid_email" };
  }
  const email = normalizeEmail(emailInput);
  if (email.length === 0) {
    return { ok: false, error: "invalid_email" };
  }

  const collection = deps.collection ?? getDefaultCollection();
  const now = deps.now ?? new Date();

  try {
    const raw = await collection.get(teamId, email);
    const status = readInvitationStatusFor(raw, { teamId, email });
    if (status === "pending") {
      await collection.markCanceled(teamId, email, now);
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
