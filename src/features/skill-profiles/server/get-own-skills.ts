import "server-only";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { readSkillProfileRecord, selectVisibleLevels } from "../domain/skill-profile";
import type { OwnSkillsDto } from "../domain/skill-profile-view";
import { getDefaultSkillCatalogReader, readSkillCatalog, type SkillCatalogReader } from "./skill-catalog";
import { getDefaultSkillProfileStore, type SkillProfileStore } from "./skill-profile-store";

export type GetOwnSkillsResult =
  | { ok: true; dto: OwnSkillsDto }
  | { ok: false; error: "unauthenticated" | "persistence_failed" };

export interface GetOwnSkillsDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: SkillProfileStore;
  catalogReader?: SkillCatalogReader;
}

/**
 * The caller's own skill list (SPEC BR-8). The subject is only the verified
 * token's uid (no `emailVerified` requirement, no role/admin logic). Profile
 * `get` and catalog query run in parallel. Never writes or repairs anything.
 */
export async function getOwnSkills(idToken: string, deps: GetOwnSkillsDeps = {}): Promise<GetOwnSkillsResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: "unauthenticated" };

  const store = deps.store ?? getDefaultSkillProfileStore();
  const catalogReader = deps.catalogReader ?? getDefaultSkillCatalogReader();

  try {
    const [data, catalog] = await Promise.all([
      store.read(verified.identity.uid),
      readSkillCatalog(catalogReader),
    ]);
    const record = readSkillProfileRecord(data);
    const levels = record.readable
      ? selectVisibleLevels(
          catalog.skills.map((skill) => skill.treeId),
          record.levels,
        )
      : undefined;

    return {
      ok: true,
      dto: {
        skills: catalog.skills.map(({ treeId, name }) => ({ treeId, name, level: levels?.get(treeId) ?? null })),
        truncated: catalog.truncated,
        profile: record.readable ? "ok" : "unreadable",
      },
    };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
