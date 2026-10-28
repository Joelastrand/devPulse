import { NextResponse } from "next/server";
import {
  getOwnRoleComparison,
  type RoleComparison,
  type RoleComparisonRow,
} from "../../../../src/features/role-profiles/server/get-own-role-comparison";

const BEARER_PATTERN = /^Bearer (.+)$/;
const NO_STORE = { "Cache-Control": "no-store" };
const ROW_KEYS = ["treeId", "treeName", "expectedLevel", "status", "ownLevel"] as const;

/** PG-4 allow-list: each state is rebuilt field by field, so no operation field can reach the response. */
function toResponseBody(comparison: RoleComparison) {
  if (comparison.state === "available") {
    return {
      state: "available",
      target: { roleId: comparison.target.roleId, name: comparison.target.name },
      rows: comparison.rows.map((row: RoleComparisonRow) => Object.fromEntries(ROW_KEYS.map((key) => [key, row[key]]))),
    };
  }
  if (comparison.state === "target_unavailable") {
    return { state: "target_unavailable", reason: comparison.reason };
  }
  return { state: "no_target" };
}

/**
 * The owner's live comparison of target role and own C1 levels (SPEC API "Derived comparison (owner)", BR-9 to BR-13).
 * No request body and no query: the only subject is the verified bearer token, which the operation checks. Never cached,
 * stored or logged.
 */
export async function GET(request: Request) {
  const match = BEARER_PATTERN.exec(request.headers.get("authorization") ?? "");

  try {
    const result = await getOwnRoleComparison(match ? match[1] : "");
    if (!result.ok) {
      const status = result.error === "unauthenticated" ? 401 : 500;
      return NextResponse.json({ error: result.error }, { status, headers: NO_STORE });
    }
    return NextResponse.json(toResponseBody(result.comparison), { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "persistence_failed" }, { status: 500, headers: NO_STORE });
  }
}
