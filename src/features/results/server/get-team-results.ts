import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import {
  verifyIdToken,
  type VerifyIdTokenDeps,
} from "../../auth/server/verify-identity";
import {
  authorizeTeamAccess,
  type AuthorizeTeamAccessDeps,
} from "../../teams/server/authorize-team-access";
import { listPrecedingClosedPeriods } from "../../pulse-survey/domain/period";
import {
  computePeriodAggregate,
  type CandidateResponseRecord,
  type PeriodAggregateResult,
} from "../domain/aggregation";

const COLLECTION_NAME = "pulseSurveyResponses";
const TREND_WINDOW_SIZE = 12;

/**
 * One persisted response record's fields relevant to reading — the same
 * shape the now-retired `get-dashboard.ts` (TASK-011) used to read,
 * redeclared here (not imported, even when that module still existed)
 * only because this operation's `teamId` is a plain, opaque `string`
 * (Firestore-backed teams — docs/features/team-management/SPEC.md), not
 * a static team-id union. The decrypt/validate/threshold/mean logic itself
 * (`computePeriodAggregate`) is imported and reused unchanged, never
 * duplicated.
 */
export interface ResultsQueryRecord extends CandidateResponseRecord {
  period: string;
}

/**
 * The read seam this operation depends on, satisfied in production by a
 * Firestore query and by an in-memory fake in tests. Scoped to one team
 * and an explicit, server-computed period list — the same query shape the
 * now-retired `get-dashboard.ts`'s `ResultsCollection` used, only widened
 * to a plain `string` `teamId`.
 */
export interface GetTeamResultsCollection {
  listForTeamAndPeriods(
    teamId: string,
    periods: readonly string[],
  ): Promise<ResultsQueryRecord[]>;
}

function getDefaultCollection(): GetTeamResultsCollection {
  return {
    async listForTeamAndPeriods(teamId, periods) {
      const snapshot = await getFirestoreDb()
        .collection(COLLECTION_NAME)
        .where("teamId", "==", teamId)
        .where("period", "in", periods as string[])
        .get();

      return snapshot.docs.map((doc) => doc.data() as ResultsQueryRecord);
    },
  };
}

export type GetTeamResultsResult =
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" }
  | {
      ok: true;
      teamId: string;
      current: PeriodAggregateResult;
      trend: PeriodAggregateResult[];
    };

export interface GetTeamResultsDeps {
  now?: Date;
  threshold?: number;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: AuthorizeTeamAccessDeps["allowList"];
  authCollection?: AuthorizeTeamAccessDeps["collection"];
  collection?: GetTeamResultsCollection;
}

/**
 * Resolves a signed-in caller's dashboard for one specific `teamId`: the
 * most recently closed period's aggregate plus the 12-closed-period
 * trend. The `get-dashboard.ts` successor
 * (docs/features/team-management/SPEC.md — Architecture decisions →
 * "`get-dashboard.ts` successor"): reuses `computePeriodAggregate` and
 * `listPrecedingClosedPeriods` unchanged; only the resolution step
 * differs — `authorizeTeamAccess` (Firestore-backed membership/app-admin
 * check) instead of the static email-to-team map.
 *
 * `teamId` may come from a client-supplied route/request value, but is
 * never itself trusted as authorization evidence (item 9): it is only
 * ever used as the argument to `authorizeTeamAccess`, which re-derives
 * the caller's access level from verified identity and server-side
 * Firestore state on every call. A `"denied"` result — including for a
 * nonexistent `teamId`, a `disabled` team with no membership, or a
 * malformed/unreadable `teams`/`teamMemberships` document
 * (`authorizeTeamAccess` fails closed) — returns a generic `"forbidden"`
 * result *before* `pulseSurveyResponses` is ever queried (BR-15). A
 * Firestore read failure *during* that authorization check itself
 * (`authorizeTeamAccess`'s `{ok: false}` result) is distinct from a
 * genuine denial and maps to the same `"read_failed"` result already
 * used for a results-query failure — never treated as authorized, and
 * `pulseSurveyResponses` is never queried in this case either.
 */
export async function getTeamResults(
  idToken: string,
  teamId: string,
  deps: GetTeamResultsDeps = {},
): Promise<GetTeamResultsResult> {
  const verified = await verifyIdToken(idToken, {
    verifyToken: deps.verifyToken,
  });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }

  const authResult = await authorizeTeamAccess(verified.identity, teamId, {
    allowList: deps.allowList,
    collection: deps.authCollection,
  });
  if (!authResult.ok) {
    return { ok: false, error: "read_failed" };
  }
  if (authResult.access === "denied") {
    return { ok: false, error: "forbidden" };
  }

  const now = deps.now ?? new Date();
  const periods = listPrecedingClosedPeriods(TREND_WINDOW_SIZE, now);

  const collection = deps.collection ?? getDefaultCollection();
  let records: ResultsQueryRecord[];
  try {
    records = await collection.listForTeamAndPeriods(teamId, periods);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const recordsByPeriod = groupByPeriod(records);
  const trend = periods.map((period) =>
    computePeriodAggregate(period, recordsByPeriod.get(period) ?? [], {
      now,
      threshold: deps.threshold,
    }),
  );

  return {
    ok: true,
    teamId,
    current: trend[trend.length - 1],
    trend,
  };
}

function groupByPeriod(
  records: readonly ResultsQueryRecord[],
): Map<string, CandidateResponseRecord[]> {
  const grouped = new Map<string, CandidateResponseRecord[]>();

  for (const { period, ...candidate } of records) {
    const existing = grouped.get(period) ?? [];
    existing.push(candidate);
    grouped.set(period, existing);
  }

  return grouped;
}
