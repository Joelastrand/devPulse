import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import {
  verifyIdToken,
  type VerifyIdTokenDeps,
} from "../../auth/server/verify-identity";
import {
  resolveTeamForUser,
  type ResolveTeamDeps,
} from "../../teams/domain/team-assignments";
import { listPrecedingClosedPeriods } from "../../pulse-survey/domain/period";
import type { TeamId } from "../../pulse-survey/domain/teams";
import {
  computePeriodAggregate,
  type CandidateResponseRecord,
  type PeriodAggregateResult,
} from "../domain/aggregation";

const COLLECTION_NAME = "pulseSurveyResponses";
const TREND_WINDOW_SIZE = 12;

/** One persisted response record's fields relevant to reading (a subset of Phase 1's persisted shape). */
export interface ResultsQueryRecord extends CandidateResponseRecord {
  period: string;
}

/**
 * The read seam this operation depends on, satisfied in production by a
 * Firestore query and by an in-memory fake in tests (mirrors
 * `PulseSurveyCollection`). Scoped to one team and an explicit, server-
 * computed period list so no caller can request another team's or an
 * unbounded set of periods (BR-6/BR-10).
 */
export interface ResultsCollection {
  listForTeamAndPeriods(
    teamId: TeamId,
    periods: readonly string[],
  ): Promise<ResultsQueryRecord[]>;
}

function getDefaultCollection(): ResultsCollection {
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

export type GetDashboardResult =
  | { ok: false; error: "unauthenticated" | "no_team" | "read_failed" }
  | {
      ok: true;
      teamId: TeamId;
      current: PeriodAggregateResult;
      trend: PeriodAggregateResult[];
    };

export interface GetDashboardDeps {
  now?: Date;
  threshold?: number;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  assignments?: ResolveTeamDeps["assignments"];
  collection?: ResultsCollection;
}

/**
 * Resolves a signed-in caller's team-scoped dashboard: the most recently
 * closed period's aggregate plus the 12-closed-period trend.
 *
 * Team and periods are never client-supplied: team comes solely from the
 * caller's verified identity (BR-4/BR-10), and periods come solely from
 * server-computed closed-period enumeration (BR-6/BR-8) — `idToken` is the
 * only externally-influenced input.
 */
export async function getDashboard(
  idToken: string,
  deps: GetDashboardDeps = {},
): Promise<GetDashboardResult> {
  const verified = await verifyIdToken(idToken, {
    verifyToken: deps.verifyToken,
  });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }

  const team = resolveTeamForUser(verified.identity, {
    assignments: deps.assignments,
  });
  if (!team.ok) {
    return { ok: false, error: "no_team" };
  }

  const now = deps.now ?? new Date();
  const periods = listPrecedingClosedPeriods(TREND_WINDOW_SIZE, now);

  const collection = deps.collection ?? getDefaultCollection();
  let records: ResultsQueryRecord[];
  try {
    records = await collection.listForTeamAndPeriods(team.teamId, periods);
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
    teamId: team.teamId,
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
