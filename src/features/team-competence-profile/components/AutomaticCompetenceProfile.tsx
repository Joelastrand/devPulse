import { buildAutomaticAxes, type AutomaticSkillLevelRow } from "../domain/automatic-profile";
import { KompetanseprofilRadar } from "./KompetanseprofilRadar";

/**
 * Inactive integration boundary between the numeric automatic team rows and the existing Kompetanseprofil radar.
 *
 * It is not rendered by any page. The caller supplies the rows, so the source is the caller's responsibility: this
 * component never fetches, never reads member data, and never invents a level. Connecting it to a real GET endpoint is
 * an activation step gated by G1, G2, G3, G4 and G5 (docs/features/team-experience-redesign/AMENDMENT-A-DRAFT.md §A.14; BLK-5 in TASKS.md).
 */
export function AutomaticCompetenceProfile({ rows }: { readonly rows: readonly AutomaticSkillLevelRow[] }) {
  return <KompetanseprofilRadar axes={buildAutomaticAxes(rows)} />;
}
