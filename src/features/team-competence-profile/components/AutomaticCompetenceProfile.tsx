import { buildAutomaticAxes, type AutomaticSkillLevelRow } from "../domain/automatic-profile";
import { KompetanseprofilRadar } from "./KompetanseprofilRadar";

/**
 * Automatic numeric team radar. It never fetches and never reads member data: the caller supplies the server's rows and
 * the same rows feed the team overview, so the radar and the overview cannot disagree. The per-area table is omitted
 * because the overview list shows the same values beside the plan actions.
 */
export function AutomaticCompetenceProfile({ rows }: { readonly rows: readonly AutomaticSkillLevelRow[] }) {
  return <KompetanseprofilRadar axes={buildAutomaticAxes(rows)} showTable={false} />;
}
