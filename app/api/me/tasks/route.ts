import { createPersonalTask, listPersonalTaskBoard } from "../../../../src/features/personal-tasks/server/task-operations";
import {
  authRefusalResponse,
  authenticateOwner,
  errorResponse,
  jsonResponse,
  operationStatus,
  readJsonBody,
} from "../../../../src/features/personal-tasks/server/task-http";

/**
 * The signed-in person's own board (Mine oppgaver). Thin: the subject is the verified token's uid; the path and query
 * name no owner. `GET` returns the visible board and the preference; `POST` creates a task.
 */
export async function GET(request: Request) {
  const verified = await authenticateOwner(request);
  if (!verified.ok) return authRefusalResponse(verified.error);
  const result = await listPersonalTaskBoard(verified.uid);
  if (!result.ok) return errorResponse(result.error, operationStatus(result.error));
  return jsonResponse(result.value, 200);
}

export async function POST(request: Request) {
  const verified = await authenticateOwner(request);
  if (!verified.ok) return authRefusalResponse(verified.error);
  const result = await createPersonalTask(verified.uid, await readJsonBody(request));
  if (!result.ok) return errorResponse(result.error, operationStatus(result.error));
  return jsonResponse(result.value, 201);
}
