import { collaborativeProfile } from "../../../../../src/features/team-competence-profile/server/collaborative-profile";
import { extractBearerToken, readJsonBody } from "../../../../../src/features/team-competence-catalog/server/competence-area-http";
import { noStoreJson, profileErrorResponse } from "./http";

/** Team profile mode and team competence levels. Any genuine member reads; only a teamadmin writes the mode. */
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const result = await collaborativeProfile.getTeamProfile(extractBearerToken(request.headers.get("authorization")), teamId);
  if (!result.ok) return profileErrorResponse(result.error);
  return noStoreJson({ mode: result.mode, levels: result.levels });
}

export async function PUT(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const body = await readJsonBody(request);
  const result = await collaborativeProfile.setTeamProfileMode(extractBearerToken(request.headers.get("authorization")), teamId, body);
  if (!result.ok) return profileErrorResponse(result.error);
  return noStoreJson({ mode: result.mode });
}
