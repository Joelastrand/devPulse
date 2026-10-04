import { screen } from "@testing-library/react";

/**
 * Accessible names of every control that mutates a plan: "Planlegg – …", "Rediger plan – …",
 * "Arkiver" (inside the editor form) and "Gjenopprett plan – …". Deliberately anchored so that
 * "Vis arkiverte", "Arkiverte" headings and filter controls never match.
 */
export const MUTATION_CONTROL_NAME = /^(Planlegg|Rediger plan|Arkiver$|Gjenopprett)/;

export function queryMutationControls(): HTMLElement[] {
  return screen.queryAllByRole("button", { name: MUTATION_CONTROL_NAME });
}
