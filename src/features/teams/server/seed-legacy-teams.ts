import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../domain/app-admin";
import { LEGACY_TEAM_SEEDS } from "../domain/legacy-team-seed";
import { requireAppAdmin } from "./require-app-admin";

const COLLECTION_NAME = "teams";

/**
 * The gRPC status code (google/rpc/code.proto — `ALREADY_EXISTS`) the
 * Firestore Admin SDK's `DocumentReference.create()` throws with when the
 * document already exists.
 */
const FIRESTORE_ALREADY_EXISTS_CODE = 6;

/**
 * Recognizes the specific error `DocumentReference.create()` throws for an
 * already-existing document, so it can be mapped to the domain-level
 * `"already_exists"` outcome rather than treated as an unexpected write
 * failure. Exported for direct unit coverage — the atomic create-only
 * guarantee this migration relies on depends on this classification being
 * correct; any other error must still surface as a failure.
 */
export function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === FIRESTORE_ALREADY_EXISTS_CODE
  );
}

/** The persisted shape written for one newly seeded legacy team. */
export interface LegacyTeamSeedRecord {
  name: string;
  status: "active";
  createdAt: Date;
  createdBy: string;
}

export type CreateIfAbsentOutcome = "created" | "already_exists";

/**
 * The write seam this operation depends on, satisfied in production by
 * Firestore's atomic `DocumentReference.create()` — which fails with
 * `ALREADY_EXISTS` if the document exists, so it never overwrites or
 * re-enables one — and by an in-memory fake in tests. There is
 * deliberately no separate existence check: a single atomic
 * create-or-fail call per legacy id is what makes this operation safe
 * under concurrent invocation (two overlapping seed calls, or any other
 * concurrent write to the same document) — a read-then-write pair would
 * reopen exactly the race this exists to close.
 */
export interface LegacyTeamSeedCollection {
  createIfAbsent(
    teamId: string,
    record: LegacyTeamSeedRecord,
  ): Promise<CreateIfAbsentOutcome>;
}

function getDefaultCollection(): LegacyTeamSeedCollection {
  const collection = getFirestoreDb().collection(COLLECTION_NAME);
  return {
    async createIfAbsent(teamId, record) {
      try {
        await collection.doc(teamId).create(record);
        return "created";
      } catch (error) {
        if (isAlreadyExistsError(error)) {
          return "already_exists";
        }
        throw error;
      }
    },
  };
}

export type LegacyTeamSeedOutcome = {
  teamId: string;
  result: "created" | "already_exists" | "failed";
};

export type SeedLegacyTeamsResult =
  | { ok: true; outcomes: LegacyTeamSeedOutcome[] }
  | { ok: false; error: "unauthenticated" | "forbidden" };

export interface SeedLegacyTeamsDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  collection?: LegacyTeamSeedCollection;
}

/**
 * One-time, explicitly-triggered (app-admin only, never auto-run) seed for
 * the four legacy team ids (`LEGACY_TEAM_SEEDS`, formerly derived from
 * `ALLOWED_TEAM_IDS` — retired in TASK-011), so any pre-existing
 * `pulseSurveyResponses.teamId` continues to resolve to a real `teams`
 * document once the dynamic survey team source replaces the static array
 * (docs/features/team-management/SPEC.md — TASK-006, "Continuity with the
 * existing static team list"). Idempotent and safe to re-run, including
 * concurrently: each legacy id is written with a single atomic
 * create-if-absent call, never a read-then-write — a document that
 * already exists, in any status, is never overwritten or silently
 * re-enabled, regardless of when or by whom it was created (another
 * overlapping seed call, or any other concurrent write to the same
 * document). Each legacy `teamId`'s outcome is reported individually so a
 * partial failure (e.g. one Firestore write failing) is never masked by
 * an overall success. `createdBy`/`createdAt` are only ever persisted when
 * this invocation is the one that actually creates the document — an
 * `"already_exists"` or `"failed"` outcome writes nothing.
 */
export async function seedLegacyTeams(
  idToken: string,
  deps: SeedLegacyTeamsDeps = {},
): Promise<SeedLegacyTeamsResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const collection = deps.collection ?? getDefaultCollection();
  const now = deps.now ?? new Date();
  const outcomes: LegacyTeamSeedOutcome[] = [];

  for (const seed of LEGACY_TEAM_SEEDS) {
    try {
      const outcome = await collection.createIfAbsent(seed.teamId, {
        name: seed.name,
        status: "active",
        createdAt: now,
        createdBy: admin.identity.uid,
      });
      outcomes.push({ teamId: seed.teamId, result: outcome });
    } catch {
      outcomes.push({ teamId: seed.teamId, result: "failed" });
    }
  }

  return { ok: true, outcomes };
}
