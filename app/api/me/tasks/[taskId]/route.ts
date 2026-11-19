import {
  deletePersonalTask,
  updatePersonalTask,
} from "../../../../../src/features/personal-tasks/server/task-operations";
import {
  authRefusalResponse,
  authenticateOwner,
  errorResponse,
  jsonResponse,
  operationStatus,
  readJsonBody,
} from "../../../../../src/features/personal-tasks/server/task-http";

type RouteContext = { params: Promise<{ taskId: string }> };

/** One own task. `PATCH` edits fields and/or moves it (`status`, `beforeTaskId`); `DELETE` removes it, idempotently. */
export async function PATCH(request: Request, { params }: RouteContext) {
  const verified = await authenticateOwner(request);
  if (!verified.ok) return authRefusalResponse(verified.error);
  const { taskId } = await params;
  const result = await updatePersonalTask(verified.uid, taskId, await readJsonBody(request));
  if (!result.ok) return errorResponse(result.error, operationStatus(result.error));
  return jsonResponse(result.value, 200);
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const verified = await authenticateOwner(request);
  if (!verified.ok) return authRefusalResponse(verified.error);
  const { taskId } = await params;
  const result = await deletePersonalTask(verified.uid, taskId);
  if (!result.ok) return errorResponse(result.error, operationStatus(result.error));
  return jsonResponse({ ok: true }, 200);
}
