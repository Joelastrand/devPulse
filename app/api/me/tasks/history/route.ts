import { listPersonalTaskHistory } from "../../../../../src/features/personal-tasks/server/task-operations";
import {
  authRefusalResponse,
  authenticateOwner,
  errorResponse,
  jsonResponse,
  operationStatus,
} from "../../../../../src/features/personal-tasks/server/task-http";

/** Completed tasks, newest first, one bounded page per request (`cursor`, `limit`). Includes tasks hidden from the board. */
export async function GET(request: Request) {
  const verified = await authenticateOwner(request);
  if (!verified.ok) return authRefusalResponse(verified.error);
  const url = new URL(request.url);
  const result = await listPersonalTaskHistory(verified.uid, {
    cursor: url.searchParams.get("cursor"),
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!result.ok) return errorResponse(result.error, operationStatus(result.error));
  return jsonResponse(result.value, 200);
}
