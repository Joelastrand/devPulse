import "server-only";
import { sortSkillRows } from "../../skill-profiles/domain/skill-profile-view";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import {
  authorizeTeamAccess,
  type AuthorizeTeamAccessDeps,
} from "../../teams/server/authorize-team-access";
import type { RequiredLevel } from "../domain/skill-need";
import {
  resolveGenuineTeamMembership,
  type GenuineMembershipDeps,
} from "./genuine-team-membership";
import {
  getDefaultSkillNeedCatalogReader,
  readSkillNeedCatalog,
  readValidSkillTree,
  type SkillNeedCatalogReader,
} from "./skill-need-catalog";
import { getDefaultSkillNeedsStore, type SkillNeedsStore } from "./skill-needs-store";

/** The complete per-need contract (SPEC BR-4, BR-22). Built field by field; no ids, timestamps, audit fields or counts. */
export interface SkillNeedView {
  treeId: string;
  areaName: string | null;
  areaAvailable: boolean;
  requiredLevel: RequiredLevel;
  requiredCoverage: number;
}

/** Server-derived UI hints, evaluated separately and never authority (SPEC BR-4). */
export interface SkillNeedsViewer {
  canManageNeeds: boolean;
  canReadCoverage: boolean;
}

export type ListSkillNeedsResult =
  | {
      ok: true;
      needs: SkillNeedView[];
      catalog: Array<{ treeId: string; name: string }>;
      catalogTruncated: boolean;
      needsTruncated: boolean;
      viewer: SkillNeedsViewer;
    }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

export interface ListSkillNeedsDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: AuthorizeTeamAccessDeps["allowList"];
  /** Seam for `authorizeTeamAccess`'s own reads. */
  collection?: AuthorizeTeamAccessDeps["collection"];
  /** Seam for the genuine-membership facts behind the `viewer` hints. */
  reads?: GenuineMembershipDeps["reads"];
  store?: SkillNeedsStore;
  catalogReader?: SkillNeedCatalogReader;
}

/**
 * Need read (SPEC BR-4, BR-6). Authorization is `authorizeTeamAccess`
 * (`member`/`admin`; `denied` ⇒ `forbidden`), the one C2 use of it: a
 * non-member app admin may read, and a disabled team stays readable. The
 * `viewer` hints come from the genuine-membership seam instead, so an
 * admin-only caller gets both `false`. Any failed read is `read_failed`,
 * never an empty list. Strictly read-only.
 */
export async function listSkillNeeds(
  idToken: string,
  teamId: string,
  deps: ListSkillNeedsDeps = {},
): Promise<ListSkillNeedsResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }

  const authorized = await authorizeTeamAccess(verified.identity, teamId, {
    allowList: deps.allowList,
    collection: deps.collection,
  });
  if (!authorized.ok) return { ok: false, error: "read_failed" };
  if (authorized.access === "denied") return { ok: false, error: "forbidden" };

  const store = deps.store ?? getDefaultSkillNeedsStore();
  const catalogReader = deps.catalogReader ?? getDefaultSkillNeedCatalogReader();

  try {
    const listed = await store.listNeeds(teamId);
    const rows = await Promise.all(
      listed.needs.map(async (need): Promise<SkillNeedView> => {
        const tree = await readValidSkillTree(catalogReader, need.treeId);
        return {
          treeId: need.treeId,
          areaName: tree?.name ?? null,
          areaAvailable: tree !== null,
          requiredLevel: need.requiredLevel,
          requiredCoverage: need.requiredCoverage,
        };
      }),
    );
    const catalog = await readSkillNeedCatalog(catalogReader);

    const membership = await resolveGenuineTeamMembership(verified.identity, teamId, { reads: deps.reads });
    if (!membership.ok) return { ok: false, error: "read_failed" };
    const active = membership.teamStatus === "active";

    return {
      ok: true,
      needs: sortNeeds(rows),
      catalog: catalog.catalog,
      catalogTruncated: catalog.truncated,
      needsTruncated: listed.truncated,
      viewer: {
        canManageNeeds: membership.relationship === "lead" && active,
        canReadCoverage: membership.relationship !== "denied" && active,
      },
    };
  } catch {
    return { ok: false, error: "read_failed" };
  }
}

/** Named areas by name, then unavailable areas by tree id; deterministic regardless of query order. */
function sortNeeds(rows: SkillNeedView[]): SkillNeedView[] {
  const available = rows.filter((row) => row.areaName !== null);
  const unavailable = rows.filter((row) => row.areaName === null);
  const byId = new Map(rows.map((row) => [row.treeId, row]));
  const named = sortSkillRows(available.map((row) => ({ treeId: row.treeId, name: row.areaName ?? "" })));
  unavailable.sort((a, b) => (a.treeId < b.treeId ? -1 : a.treeId > b.treeId ? 1 : 0));
  return [...named.flatMap(({ treeId }) => byId.get(treeId) ?? []), ...unavailable];
}
