"use client";

import Link from "next/link";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchAdminSkillTrees, type FetchAdminSkillTreesResult } from "../client/skill-trees-gateway";
import { adminSkillsCopy } from "../copy";
import { useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { LoadingState } from "../../../components/ui/LoadingState";
import { SkillTreeCreationForm } from "./SkillTreeCreationForm";
import { SkillTreeCatalogList, type SkillTreeCatalogState } from "./SkillTreeCatalogList";

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "loaded"; token: string; generation: number; result: FetchAdminSkillTreesResult };

/**
 * Admin-only `/admin/skills` page (docs/features/team-skill-tree/SPEC.md —
 * TASK-005, BR-26, BR-34). Mirrors `AdminTeams`' client-side auth-state and
 * generation-guard pattern via `useAuthGatedResource`: the client holds the
 * Firebase ID token (no server session) and every admin operation
 * (`listSkillTrees`, `createSkillTree`, `updateSkillTree`) is re-authorized
 * server-side on every call via the existing, unchanged `requireAppAdmin`
 * boundary — this component never decides admin status itself.
 */
export function AdminSkills() {
  const [state, setState] = useState<ViewState>({ phase: "loading" });

  const { isCurrentGeneration } = useAuthGatedResource((token, generation) => {
    if (!token) {
      setState({ phase: "signed_out" });
      return;
    }

    setState({ phase: "loading" });
    loadForGeneration(token, generation);
  });

  async function loadForGeneration(token: string, generation: number) {
    const result = await fetchAdminSkillTrees(token);
    if (isCurrentGeneration(generation)) {
      setState({ phase: "loaded", token, generation, result });
    }
  }

  if (state.phase === "loading") {
    return <LoadingState label={adminSkillsCopy.loading} />;
  }

  if (state.phase === "signed_out") {
    return <SignInPrompt />;
  }

  const { result, token, generation } = state;

  if (result.status === "unauthenticated") {
    return <SignInPrompt />;
  }

  if (result.status === "forbidden") {
    // Deliberately generic — never confirms or denies whether the caller's
    // email is on the server-only `APP_ADMIN_EMAILS` allow-list.
    return <Alert variant="error">{adminSkillsCopy.forbidden}</Alert>;
  }

  const catalogState: SkillTreeCatalogState =
    result.status === "read_failed" ? { status: "error" } : { status: "loaded", trees: result.trees };

  return (
    <div className="flex flex-col gap-8">
      <SkillTreeCreationForm token={token} onCreated={() => loadForGeneration(token, generation)} />
      <SkillTreeCatalogList
        state={catalogState}
        token={token}
        onChanged={() => loadForGeneration(token, generation)}
      />
    </div>
  );
}

function SignInPrompt() {
  return (
    <p className="text-zinc-600 dark:text-zinc-400">
      <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
        {adminSkillsCopy.signInLink}
      </Link>{" "}
      {adminSkillsCopy.signInPrompt}
    </p>
  );
}
