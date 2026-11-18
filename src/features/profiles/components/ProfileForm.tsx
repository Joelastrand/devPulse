"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { LoadingRegion, Skeleton, SkeletonCard } from "../../../components/ui/Skeleton";
import { TextField } from "../../../components/ui/TextField";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import {
  fetchOwnProfile,
  removeOwnProfile,
  saveOwnProfile,
  type SaveOwnProfileResult,
} from "../client/profile-gateway";
import { profileCopy } from "../copy";

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "load_error"; token: string; generation: number }
  | { phase: "ready"; token: string; generation: number; savedName: string | null };

type ActionState =
  | { status: "idle" }
  | { status: "pending"; kind: "save" | "remove" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

/** Placeholder in the loaded card's order: the current-name line, the field, and the action row. No text or name. */
function ProfileFormSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label}>
      <SkeletonCard className="flex flex-col gap-4 p-6">
        <div aria-hidden="true" className="flex flex-col gap-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-9 w-32" />
        </div>
      </SkeletonCard>
    </LoadingRegion>
  );
}

function saveErrorMessage(error: Exclude<SaveOwnProfileResult, { ok: true }>["error"]): string {
  if (error === "invalid_input") return profileCopy.invalidName;
  if (error === "unauthenticated") return profileCopy.signInAgain;
  return profileCopy.genericError;
}

/**
 * The signed-in user's own display-name form (docs/archive/features/member-identity-
 * and-team-roles/SPEC.md — BR-30). Auth state and stale-response protection
 * come from the shared `useAuthGatedResource` generation guard; the server
 * (`/api/me/profile`) is the only authority on validity and identity, so the
 * only client-side check is "not empty" — no length or character rules are
 * duplicated here (the server counts Unicode code points, which a native
 * `maxLength` would not). After a save the field shows the **server's**
 * canonical value, never the raw input; there is no optimistic state, and
 * the name is never pre-filled from e-mail or anything else. Save and
 * remove block each other while either is in flight.
 */
export function ProfileForm() {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [value, setValue] = useState("");
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const writeInFlight = useRef(false);

  const { isCurrentGeneration } = useAuthGatedResource((token, generation) => {
    setAction({ status: "idle" });
    setValue("");

    if (!token) {
      setState({ phase: "signed_out" });
      return;
    }

    setState({ phase: "loading" });
    loadForGeneration(token, generation);
  });

  async function loadForGeneration(token: string, generation: number) {
    const result = await fetchOwnProfile(token);
    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (result.status === "unauthenticated") {
      setState({ phase: "signed_out" });
      return;
    }
    if (result.status !== "ok") {
      setState({ phase: "load_error", token, generation });
      return;
    }

    setValue(result.displayName ?? "");
    setState({ phase: "ready", token, generation, savedName: result.displayName });
  }

  function handleRetry(token: string, generation: number) {
    setState({ phase: "loading" });
    loadForGeneration(token, generation);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>, token: string, generation: number) {
    event.preventDefault();
    // A ref, so a second submit before the next render (Enter key) is blocked. Save and remove share it.
    if (writeInFlight.current) {
      return;
    }
    if (value.trim() === "") {
      setAction({ status: "error", message: profileCopy.emptyName });
      return;
    }

    writeInFlight.current = true;
    setAction({ status: "pending", kind: "save" });
    try {
      const result = await saveOwnProfile(token, value);
      if (!isCurrentGeneration(generation)) {
        return;
      }

      if (!result.ok) {
        setAction({ status: "error", message: saveErrorMessage(result.error) });
        return;
      }

      setValue(result.displayName);
      setState({ phase: "ready", token, generation, savedName: result.displayName });
      setAction({ status: "success", message: profileCopy.saved });
    } finally {
      writeInFlight.current = false;
    }
  }

  async function handleRemove(token: string, generation: number) {
    if (writeInFlight.current) {
      return;
    }

    writeInFlight.current = true;
    setAction({ status: "pending", kind: "remove" });
    try {
      const result = await removeOwnProfile(token);
      if (!isCurrentGeneration(generation)) {
        return;
      }

      if (!result.ok) {
        setAction({
          status: "error",
          message: result.error === "unauthenticated" ? profileCopy.signInAgain : profileCopy.genericError,
        });
        return;
      }

      setValue("");
      setState({ phase: "ready", token, generation, savedName: null });
      setAction({ status: "success", message: profileCopy.removed });
    } finally {
      writeInFlight.current = false;
    }
  }

  if (state.phase === "loading") {
    return <ProfileFormSkeleton label={profileCopy.loading} />;
  }

  if (state.phase === "signed_out") {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
          {profileCopy.signInLink}
        </Link>{" "}
        {profileCopy.signInPrompt}
      </p>
    );
  }

  if (state.phase === "load_error") {
    const { token: retryToken, generation: retryGeneration } = state;
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="error">{profileCopy.loadError}</Alert>
        <Button variant="secondary" size="sm" onClick={() => handleRetry(retryToken, retryGeneration)}>
          {profileCopy.retryButton}
        </Button>
      </div>
    );
  }

  const { token, generation, savedName } = state;
  const pending = action.status === "pending";

  return (
    <Card as="section" className="flex flex-col gap-4">
      <p className="text-zinc-700 dark:text-zinc-300">
        {savedName === null ? (
          profileCopy.noName
        ) : (
          <>
            {profileCopy.currentNamePrefix} <span className="font-medium">{savedName}</span>
          </>
        )}
      </p>

      <form id="profile-form" className="flex flex-col gap-4" onSubmit={(event) => handleSave(event, token, generation)} noValidate>
        <TextField
          id="display-name"
          label={profileCopy.fieldLabel}
          description={profileCopy.fieldDescription}
          autoComplete="nickname"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (action.status === "success" || action.status === "error") {
              setAction({ status: "idle" });
            }
          }}
          error={action.status === "error" ? action.message : undefined}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" pending={pending}>
            {pending && action.kind === "save" ? profileCopy.savingButton : profileCopy.saveButton}
          </Button>
          {savedName !== null && (
            <Button type="button" variant="secondary" pending={pending} onClick={() => handleRemove(token, generation)}>
              {pending && action.kind === "remove" ? profileCopy.removingButton : profileCopy.removeButton}
            </Button>
          )}
        </div>
        {savedName !== null && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{profileCopy.removeHint}</p>
        )}
      </form>

      {action.status === "success" && <Alert variant="success">{action.message}</Alert>}
    </Card>
  );
}
