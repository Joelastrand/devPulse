import {
  setPersonalTaskPreferences,
} from "../../../../../src/features/personal-tasks/server/task-operations";
import {
  authRefusalResponse,
  authenticateOwner,
  errorResponse,
  jsonResponse,
  operationStatus,
  readJsonBody,
} from "../../../../../src/features/personal-tasks/server/task-http";

/** The owner's board preference for completed tasks (`completedVisibility`). */
export async function PUT(request: Request) {
  const verified = await authenticateOwner(request);
  if (!verified.ok) return authRefusalResponse(verified.error);
  const result = await setPersonalTaskPreferences(verified.uid, await readJsonBody(request));
  if (!result.ok) return errorResponse(result.error, operationStatus(result.error));
  return jsonResponse(result.value, 200);
}
