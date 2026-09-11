import "server-only";
import { getAdminAuth, getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../domain/app-admin";
import { isValidPendingAccessRequestForTeam } from "../domain/team-access-request";
import { requireAppAdmin } from "./require-app-admin";

const REQUESTS_COLLECTION = "teamAccessRequests";

/** One pending access request row for admin display (BR-30). */
export interface PendingAccessRequest {
  uid: string;
  email: string | null;
  createdAt: Date;
}

/**
 * The read seam this operation depends on, satisfied in production by a
 * Firestore compound query (`teamId ==` and `status == "pending"`,
 * mirroring `resolve-invitations.ts`'s `(email, status)` query shape) and
 * by an in-memory fake in tests. Returns raw, unvalidated document data —
 * `listTeamAccessRequests` validates each one before use.
 */
export interface TeamAccessRequestsCollection {
  listPendingRawForTeam(teamId: string): Promise<unknown[]>;
}

function getDefaultCollection(): TeamAccessRequestsCollection {
  return {
    async listPendingRawForTeam(teamId) {
      const snapshot = await getFirestoreDb()
        .collection(REQUESTS_COLLECTION)
        .where("teamId", "==", teamId)
        .where("status", "==", "pending")
        .get();
      return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          ...data,
          createdAt: data.createdAt?.toDate?.() ?? data.createdAt,
        };
      });
    },
  };
}

type GetUser = (uid: string) => Promise<{ email?: string | null }>;

function defaultGetUser(uid: string) {
  return getAdminAuth().getUser(uid);
}

export type ListTeamAccessRequestsResult =
  | { ok: true; requests: PendingAccessRequest[] }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

export interface ListTeamAccessRequestsDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  collection?: TeamAccessRequestsCollection;
  getUser?: GetUser;
}

/**
 * Lists a team's pending access requests for an app admin
 * (docs/features/team-management/SPEC.md — BR-30). Each requester's email
 * is resolved live from Firebase Auth per `uid` — never persisted on or
 * read from the `teamAccessRequests` document itself (SPEC → Architecture
 * decisions → "Firestore collections": deliberately no persisted email),
 * mirroring `listTeamMembers`'s established pattern. A request whose `uid`
 * no longer resolves to a live Firebase account is excluded rather than
 * fabricating a value.
 */
export async function listTeamAccessRequests(
  idToken: string,
  teamId: string,
  deps: ListTeamAccessRequestsDeps = {},
): Promise<ListTeamAccessRequestsResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const collection = deps.collection ?? getDefaultCollection();
  const getUser = deps.getUser ?? defaultGetUser;

  let rawDocs: unknown[];
  try {
    rawDocs = await collection.listPendingRawForTeam(teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const candidates = rawDocs.filter((doc) => isValidPendingAccessRequestForTeam(doc, teamId));

  const requests: PendingAccessRequest[] = [];
  for (const candidate of candidates) {
    try {
      const userRecord = await getUser(candidate.uid);
      requests.push({
        uid: candidate.uid,
        email: userRecord.email ?? null,
        createdAt: candidate.createdAt,
      });
    } catch {
      // uid no longer resolves to a live Firebase account — exclude rather
      // than fabricate a value.
    }
  }

  return { ok: true, requests };
}
