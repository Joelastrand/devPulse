import { NextResponse } from "next/server";
import { authenticate, RECORD_ERROR_STATUS, recordIdParam } from "../../../../../src/features/personal-role-workspace/server/route-support";
import { deleteResponsibility, productionPersonalRecordDeps, updateResponsibility } from "../../../../../src/features/personal-role-workspace/server/record-operations";
import { readResponsibilityPatch } from "../../../../../src/features/personal-role-workspace/server/request-body";
import { authRefusalStatus } from "../../../../../src/features/auth/server/auth-refusal";

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE });

type RouteContext = { params: Promise<{ recordId: string }> };

/** Update and delete of one own responsibility (SPEC BR-11, BR-12, BR-14). Only the verified uid selects the record. */
export async function PATCH(request: Request, context: RouteContext) {
  const verified = await authenticate(request);
  if (!verified.ok) return json({ error: verified.error }, authRefusalStatus(verified.error));
  const { recordId } = await context.params;
  const id = recordIdParam(recordId);
  if (id === null) return json({ error: "not_found" }, 404);

  const body = await readResponsibilityPatch(request);
  if (!body.ok) return json({ error: body.error }, body.error === "payload_too_large" ? 413 : 400);

  const result = await updateResponsibility(verified.uid, id, body.value, productionPersonalRecordDeps());
  if (!result.ok) return json({ error: result.error }, RECORD_ERROR_STATUS[result.error]);
  return json(result.dto, 200);
}

export async function DELETE(request: Request, context: RouteContext) {
  const verified = await authenticate(request);
  if (!verified.ok) return json({ error: verified.error }, authRefusalStatus(verified.error));
  const { recordId } = await context.params;
  const id = recordIdParam(recordId);
  if (id === null) return json({ error: "not_found" }, 404);

  const result = await deleteResponsibility(verified.uid, id, productionPersonalRecordDeps());
  if (!result.ok) return json({ error: result.error }, RECORD_ERROR_STATUS[result.error]);
  return json({ deleted: true }, 200);
}
