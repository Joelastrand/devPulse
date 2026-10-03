import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../domain/app-admin";
import { generateMemberRef, memberRefOf } from "../domain/member-ref";
import { isValidTeamStatus } from "../domain/team";
import { extractMemberUid, membershipDocId } from "../domain/team-membership";
import { requireAppAdmin } from "./require-app-admin";

const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/** Defensive bound shared with the roster and assignable-members reads (SPEC — D12). */
const MEMBERSHIP_BOUND = 500;

/**
 * One raw `teamMemberships` document read inside the transaction. `id` is used
 * only to target the later `update`; it never leaves this module.
 */
export interface RawMembership {
  id: string;
  data: unknown;
}

/**
 * The reads/writes one preparation may perform, all inside a single
 * transaction scoped to one team. `setMemberRef` can only `update` an existing
 * membership document (never create one) and writes nothing but `memberRef`.
 */
export interface MaterializeTransaction {
  getTeamStatus(): Promise<unknown>;
  listMemberships(limit: number): Promise<RawMembership[]>;
  setMemberRef(id: string, memberRef: string): void;
}

export interface MaterializeMemberRefsCollection {
  run<T>(teamId: string, work: (tx: MaterializeTransaction) => Promise<T>): Promise<T>;
}

function getDefaultCollection(): MaterializeMemberRefsCollection {
  return {
    async run(teamId, work) {
      const db = getFirestoreDb();
      const teamRef = db.collection(TEAMS_COLLECTION).doc(teamId);

      return db.runTransaction(async (tx) => {
        // Firestore requires every read before the first write; updates are
        // only queued here and applied after `work` has finished reading.
        const pending: Array<{ id: string; memberRef: string }> = [];
        const result = await work({
          async getTeamStatus() {
            const snapshot = await tx.get(teamRef);
            return snapshot.exists ? snapshot.data()?.status : undefined;
          },
          async listMemberships(limit) {
            const snapshot = await tx.get(
              db.collection(MEMBERSHIPS_COLLECTION).where("teamId", "==", teamId).limit(limit),
            );
            return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
          },
          setMemberRef(id, memberRef) {
            pending.push({ id, memberRef });
          },
        });
        for (const { id, memberRef } of pending) {
          tx.update(db.collection(MEMBERSHIPS_COLLECTION).doc(id), { memberRef });
        }
        return result;
      });
    },
  };
}

export type MaterializeMemberRefsResult =
  | { ok: true; materialized: number; alreadyHad: number; truncated: boolean }
  | { ok: false; error: "unauthenticated" | "forbidden" | "team_not_found" | "persistence_failed" };

export interface MaterializeMemberRefsDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  collection?: MaterializeMemberRefsCollection;
  generateRef?: () => string;
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("/");
}

/**
 * Gives every existing membership of one team that lacks a valid `memberRef`
 * a fresh one (docs/features/team-skill-planning/SPEC.md — BR-2, BR-3, D12).
 * App-admin-only via `requireAppAdmin`; any team status (`active` or
 * `disabled`) is allowed because this is infrastructure, not a roadmap write.
 *
 * One transaction reads the team and its memberships (`teamId ==`, limit 501)
 * and `update`s only the memberships whose ref is absent or malformed, so a
 * membership removed concurrently is never recreated (the commit fails and
 * nothing is written) and a valid ref is never rotated — a repeat run is a
 * no-op. A new ref that collides with one already held in the team is
 * regenerated. All updates commit or none do. With more than 500 memberships
 * the first 500 are processed and `truncated: true` is reported; the rest stay
 * unprepared (the documented bound shared with the roster read).
 */
export async function materializeMemberRefs(
  idToken: string,
  teamId: string,
  deps: MaterializeMemberRefsDeps = {},
): Promise<MaterializeMemberRefsResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  if (!isSafeId(teamId)) {
    return { ok: false, error: "team_not_found" };
  }

  const collection = deps.collection ?? getDefaultCollection();
  const generateRef = deps.generateRef ?? generateMemberRef;

  try {
    return await collection.run(teamId, async (tx): Promise<MaterializeMemberRefsResult> => {
      if (!isValidTeamStatus(await tx.getTeamStatus())) {
        return { ok: false, error: "team_not_found" };
      }

      const fetched = await tx.listMemberships(MEMBERSHIP_BOUND + 1);
      const truncated = fetched.length > MEMBERSHIP_BOUND;

      // Only documents that are genuinely this team's memberships count: the
      // id must be the deterministic one for the document's own uid and team.
      const memberships = fetched.slice(0, MEMBERSHIP_BOUND).filter(({ id, data }) => {
        const uid = extractMemberUid(data);
        return (
          uid !== null &&
          (data as Record<string, unknown>).teamId === teamId &&
          id === membershipDocId(uid, teamId)
        );
      });

      const held = new Set<string>();
      const missing: RawMembership[] = [];
      for (const membership of memberships) {
        const ref = memberRefOf(membership.data);
        if (ref === null) {
          missing.push(membership);
        } else {
          held.add(ref);
        }
      }

      for (const { id } of missing) {
        let ref = generateRef();
        while (held.has(ref)) {
          ref = generateRef();
        }
        held.add(ref);
        tx.setMemberRef(id, ref);
      }

      return {
        ok: true,
        materialized: missing.length,
        alreadyHad: memberships.length - missing.length,
        truncated,
      };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
