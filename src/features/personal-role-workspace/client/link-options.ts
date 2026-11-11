"use client";

import { fetchGoals } from "../../personal-goals/client/goals-gateway";
import type { GatewayResult } from "./records-gateway";
import { fetchResponsibilities } from "./records-gateway";

/**
 * Options for the link pickers, read through the owner's own list routes only. A goal or responsibility shows its title;
 * no other goal field, and no other person's data, reaches this feature.
 */
export interface LinkChoice {
  id: string;
  title: string;
}

export async function fetchGoalChoices(token: string): Promise<GatewayResult<LinkChoice[]>> {
  const result = await fetchGoals(token);
  if (result.status === "ok") {
    return { ok: true, value: result.response.goals.map((goal) => ({ id: goal.id, title: goal.title })) };
  }
  return { ok: false, error: result.status === "unauthenticated" ? "unauthenticated" : "read_failed" };
}

export async function fetchResponsibilityChoices(token: string): Promise<GatewayResult<LinkChoice[]>> {
  const result = await fetchResponsibilities(token);
  if (!result.ok) return result;
  return { ok: true, value: result.value.records.map((record) => ({ id: record.id, title: record.title })) };
}
