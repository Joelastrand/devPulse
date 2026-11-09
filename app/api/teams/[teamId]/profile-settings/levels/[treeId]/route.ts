import { collaborativeProfile } from "../../../../../../../src/features/team-competence-profile/server/collaborative-profile";
import { extractBearerToken, readJsonBody } from "../../../../../../../src/features/team-competence-catalog/server/competence-area-http";
import { noStoreJson, profileErrorResponse } from "../../http";

/** Teamadmin only: sets (1–4) or clears (`null`) one collaborative team level for an active competence area. */
export async function PUT(request: Request, { params }: { params: Promise<{ teamId: string; treeId: string }> }) {
  const { teamId, treeId } = await params;
  const body = await readJsonBody(request);
  const result = await collaborativeProfile.setCollaborativeLevel(
    extractBearerToken(request.headers.get("authorization")),
    teamId,
    treeId,
    body,
  );
  if (!result.ok) return profileErrorResponse(result.error);
  return noStoreJson({ treeId: result.treeId, level: result.level });
}
