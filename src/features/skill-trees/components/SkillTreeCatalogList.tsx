"use client";

import { useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import type { AdminSkillTreeEntry } from "../client/skill-trees-gateway";
import { adminSkillsCopy } from "../copy";
import { SkillTreeCorrectionForm } from "./SkillTreeCorrectionForm";

export type SkillTreeCatalogState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; trees: AdminSkillTreeEntry[] };

/**
 * The TASK-005 SkillTree catalog list (docs/features/team-skill-tree/
 * SPEC.md — BR-6, BR-26, BR-34): renders the bounded catalog `GET
 * /api/admin/skills` returns, each entry with its full ordered stage list
 * and a "Rett opp" correction action. Deliberately never renders a
 * "showing all trees"/total-count claim anywhere — the 500-document server
 * bound may be silently hiding older trees (BR-6), and this list must never
 * imply otherwise.
 */
export function SkillTreeCatalogList({
  state,
  token,
  onChanged,
}: {
  state: SkillTreeCatalogState;
  token: string;
  onChanged: () => void;
}) {
  const [openTreeId, setOpenTreeId] = useState<string | null>(null);

  if (state.status === "loading") {
    return <LoadingState label={adminSkillsCopy.loading} />;
  }

  if (state.status === "error") {
    return <Alert variant="error">{adminSkillsCopy.error}</Alert>;
  }

  const { trees } = state;

  if (trees.length === 0) {
    return <EmptyState>{adminSkillsCopy.empty}</EmptyState>;
  }

  return (
    <section aria-labelledby="skill-tree-catalog-heading" className="flex flex-col gap-4">
      <h2 id="skill-tree-catalog-heading" className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
        {adminSkillsCopy.catalog.sectionTitle}
      </h2>
      <ul className="flex flex-col gap-3">
        {trees.map((tree) => (
          <Card as="li" key={tree.treeId} variant="bordered" padding="sm">
            <p className="font-medium text-zinc-900 dark:text-zinc-50">{tree.name}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{adminSkillsCopy.catalog.stagesLabel}</p>
            <ol className="ml-5 list-decimal text-sm text-zinc-700 dark:text-zinc-300">
              {tree.nodes.map((node) => (
                <li key={node.nodeId}>{node.label}</li>
              ))}
            </ol>

            {openTreeId === tree.treeId ? (
              <SkillTreeCorrectionForm
                tree={tree}
                token={token}
                onSuccess={() => {
                  setOpenTreeId(null);
                  onChanged();
                }}
                onCancel={() => setOpenTreeId(null)}
              />
            ) : (
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() => setOpenTreeId(tree.treeId)}
              >
                {adminSkillsCopy.correction.openButton}
              </Button>
            )}
          </Card>
        ))}
      </ul>
    </section>
  );
}
