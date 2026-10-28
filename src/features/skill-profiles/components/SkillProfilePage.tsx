"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { Select } from "../../../components/ui/Select";
import { DeleteConfirmation, type DeleteActionState } from "../../forum/components/DeleteConfirmation";
import {
  clearOwnSkillLevel,
  deleteOwnSkillProfile,
  fetchOwnSkills,
  setOwnSkillLevel,
} from "../client/skill-profile-gateway";
import { isSelfAssessedLevel, SELF_ASSESSED_LEVELS, type SelfAssessedLevel } from "../domain/self-assessed-level";
import { deriveOverview, type OwnSkillsDto } from "../domain/skill-profile-view";
import { SELF_ASSESSED_LEVEL_COPY, skillProfileCopy } from "../copy";

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "load_error"; token: string; generation: number }
  | { phase: "ready"; dto: OwnSkillsDto; token: string; generation: number };

/** Per-row save feedback, keyed by `treeId` (never by list index). */
type RowStatus = { kind: "pending" } | { kind: "failed"; message: string };
type RowStatusMap = Readonly<Record<string, RowStatus | undefined>>;
type SkillFilter = "all" | "assessed" | "unassessed";

/**
 * The signed-in person's own skill list (docs/features/individual-
 * skill-self-assessment/SPEC.md — BR-16, BR-25, BR-27, BR-30, BR-31). Data comes
 * only from the own-skills API via the gateway; the server DTO (including its
 * order and `truncated` flag) is rendered as given. Each row saves immediately
 * on change with no optimistic update: a row's level changes only to the
 * server's canonical value after success, and its control is disabled while its
 * own request is in flight. Auth state and stale-response
 * protection come from `useAuthGatedResource`: a new identity resets to
 * loading, so nothing from a previous identity stays rendered. Signed out
 * makes no request. "Nullstill alle ferdigheter" (BR-25) physically deletes the
 * own profile after confirmation, also as recovery from an unreadable profile;
 * it is never optimistic. Row edits are blocked while it is confirming or
 * pending, and it is blocked while a row save is pending, so no stale row
 * response can resurrect a level after a reset.
 */
export function SkillProfilePage() {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [rowStatus, setRowStatus] = useState<RowStatusMap>({});
  const [resetState, setResetState] = useState<DeleteActionState>({ status: "idle" });
  const [resetDone, setResetDone] = useState(false);
  const pendingRows = useRef(new Set<string>());
  /** Bumped when the stored profile is found unreadable or erased; responses from work started earlier are discarded. */
  const stateEpoch = useRef(0);

  const { isCurrentGeneration } = useAuthGatedResource((token, generation) => {
    if (!token) {
      setState({ phase: "signed_out" });
      return;
    }
    setState({ phase: "loading" });
    loadForGeneration(token, generation);
  });

  function discardRowState() {
    pendingRows.current = new Set();
    setRowStatus({});
    setResetState({ status: "idle" });
    setResetDone(false);
  }

  async function loadForGeneration(token: string, generation: number) {
    discardRowState();
    const result = await fetchOwnSkills(token);
    if (!isCurrentGeneration(generation)) return;

    if (result.status === "unauthenticated") {
      setState({ phase: "signed_out" });
      return;
    }
    if (result.status !== "ok") {
      setState({ phase: "load_error", token, generation });
      return;
    }
    setState({ phase: "ready", dto: result.dto, token, generation });
  }

  async function saveLevel(token: string, generation: number, treeId: string, level: SelfAssessedLevel | null) {
    if (pendingRows.current.has(treeId)) return;
    pendingRows.current.add(treeId);
    setResetDone(false);
    const epoch = stateEpoch.current;
    setRowStatus((current) => ({ ...current, [treeId]: { kind: "pending" } }));

    const result =
      level === null ? await clearOwnSkillLevel(token, treeId) : await setOwnSkillLevel(token, treeId, level);
    if (!isCurrentGeneration(generation)) return;
    pendingRows.current.delete(treeId);

    if (epoch !== stateEpoch.current) {
      // Started before the profile became unreadable or was erased: its outcome must not restore state.
      setRowStatus((current) => withoutRow(current, treeId));
      return;
    }

    if (result.ok) {
      setRowStatus((current) => ({ ...current, [treeId]: undefined }));
      setState((current) =>
        current.phase === "ready" && current.generation === generation
          ? {
              ...current,
              dto: {
                ...current.dto,
                skills: current.dto.skills.map((row) => (row.treeId === treeId ? { ...row, level: result.level } : row)),
              },
            }
          : current,
      );
      return;
    }

    if (result.error === "unauthenticated") {
      // BR-30: pending edits are discarded and nothing from this identity stays rendered.
      discardRowState();
      setState({ phase: "signed_out" });
      return;
    }

    if (result.error === "profile_unreadable") {
      // BR-30: the stored profile cannot be read; the page moves to the read-only recovery state.
      // Other saves still in flight stay pending (recovery waits for them) but can no longer apply.
      stateEpoch.current += 1;
      setRowStatus((current) => onlyPending(withoutRow(current, treeId)));
      setState((current) =>
        current.phase === "ready" && current.generation === generation
          ? { ...current, dto: { ...current.dto, profile: "unreadable" } }
          : current,
      );
      return;
    }

    const unavailable = result.error === "skill_unavailable";
    setRowStatus((current) => ({
      ...current,
      [treeId]: { kind: "failed", message: unavailable ? skillProfileCopy.skillUnavailable : skillProfileCopy.saveFailed },
    }));
    if (unavailable) await refetchCatalog(token, generation);
  }

  /** The single catalog refetch after a 404; if it fails the current list stays and the row error already explains. */
  async function refetchCatalog(token: string, generation: number) {
    const epoch = stateEpoch.current;
    const refreshed = await fetchOwnSkills(token);
    if (!isCurrentGeneration(generation) || epoch !== stateEpoch.current) return;
    if (refreshed.status === "unauthenticated") {
      discardRowState();
      setState({ phase: "signed_out" });
      return;
    }
    if (refreshed.status !== "ok") return;
    setState((current) =>
      current.phase === "ready" && current.generation === generation ? { ...current, dto: refreshed.dto } : current,
    );
  }

  async function resetAll(token: string, generation: number) {
    setResetState({ status: "pending" });
    const result = await deleteOwnSkillProfile(token);
    if (!isCurrentGeneration(generation)) return;

    if (result.ok) {
      stateEpoch.current += 1;
      setResetState({ status: "idle" });
      setResetDone(true);
      setState((current) =>
        current.phase === "ready" && current.generation === generation
          ? {
              ...current,
              dto: {
                ...current.dto,
                profile: "ok",
                skills: current.dto.skills.map((row) => ({ ...row, level: null })),
              },
            }
          : current,
      );
      return;
    }

    if (result.error === "unauthenticated") {
      discardRowState();
      setState({ phase: "signed_out" });
      return;
    }
    setResetState({ status: "error", message: skillProfileCopy.resetFailed });
  }

  function handleRetry(token: string, generation: number) {
    setState({ phase: "loading" });
    loadForGeneration(token, generation);
  }

  if (state.phase === "loading") {
    return <LoadingState label={skillProfileCopy.loading} />;
  }

  if (state.phase === "signed_out") {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
          {skillProfileCopy.signInLink}
        </Link>{" "}
        {skillProfileCopy.signInPrompt}
      </p>
    );
  }

  if (state.phase === "load_error") {
    const { token, generation } = state;
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="error">{skillProfileCopy.loadError}</Alert>
        <Button variant="secondary" size="sm" onClick={() => handleRetry(token, generation)}>
          {skillProfileCopy.retryButton}
        </Button>
      </div>
    );
  }

  const { token, generation } = state;
  return (
    <ReadyView
      dto={state.dto}
      rowStatus={rowStatus}
      resetState={resetState}
      resetDone={resetDone}
      onChangeLevel={(treeId, level) => saveLevel(token, generation, treeId, level)}
      onRequestReset={() => {
        // A new reset attempt makes the previous success announcement stale.
        setResetDone(false);
        setResetState({ status: "confirming" });
      }}
      onCancelReset={() => setResetState({ status: "idle" })}
      onConfirmReset={() => resetAll(token, generation)}
    />
  );
}

function withoutRow(statuses: RowStatusMap, treeId: string): RowStatusMap {
  return { ...statuses, [treeId]: undefined };
}

function onlyPending(statuses: RowStatusMap): RowStatusMap {
  return Object.fromEntries(Object.entries(statuses).filter(([, status]) => status?.kind === "pending"));
}

function ReadyView({
  dto,
  rowStatus,
  resetState,
  resetDone,
  onChangeLevel,
  onRequestReset,
  onCancelReset,
  onConfirmReset,
}: {
  dto: OwnSkillsDto;
  rowStatus: RowStatusMap;
  resetState: DeleteActionState;
  resetDone: boolean;
  onChangeLevel: (treeId: string, level: SelfAssessedLevel | null) => void;
  onRequestReset: () => void;
  onCancelReset: () => void;
  onConfirmReset: () => void;
}) {
  const readable = dto.profile === "ok";
  const resetInProgress = resetState.status === "confirming" || resetState.status === "pending";
  const rowSavePending = Object.values(rowStatus).some((status) => status?.kind === "pending");
  const showReset = !readable || dto.truncated || dto.skills.some((skill) => skill.level !== null);
  const [filter, setFilter] = useState<SkillFilter>("all");
  const resetStatus = useRef<HTMLParagraphElement>(null);
  const resetStatusActive = resetState.status === "pending" || resetDone;

  // The confirm button and, after success, the reset trigger unmount: keep focus on a stable, announced element.
  useEffect(() => {
    if (resetStatusActive) resetStatus.current?.focus();
  }, [resetStatusActive]);

  const visibleSkills = dto.skills.filter(
    (skill) => filter === "all" || (filter === "assessed" ? skill.level !== null : skill.level === null),
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{skillProfileCopy.privacyNotice}</p>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{skillProfileCopy.roleComparisonNotice}</p>

      <section aria-labelledby="skill-legend-heading">
        <h2 id="skill-legend-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {skillProfileCopy.legendHeading}
        </h2>
        <dl className="mt-2 flex flex-col gap-2 text-sm">
          {SELF_ASSESSED_LEVELS.map((level) => (
            <div key={level}>
              <dt className="font-medium text-zinc-900 dark:text-zinc-50">{SELF_ASSESSED_LEVEL_COPY[level].name}</dt>
              <dd className="text-zinc-600 dark:text-zinc-400">{SELF_ASSESSED_LEVEL_COPY[level].description}</dd>
            </div>
          ))}
        </dl>
      </section>

      {!readable && <Alert variant="error">{skillProfileCopy.unreadableNotice}</Alert>}
      {dto.truncated && <Alert variant="info">{skillProfileCopy.truncatedNotice}</Alert>}

      {dto.skills.length === 0 ? (
        <EmptyState>{skillProfileCopy.noSkillsDefined}</EmptyState>
      ) : (
        <>
          {readable && <Overview dto={dto} />}
          <section aria-labelledby="skill-list-heading">
            <h2 id="skill-list-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {skillProfileCopy.skillsHeading}
            </h2>
            {readable && <FilterControl value={filter} onChange={setFilter} />}
            {visibleSkills.length === 0 ? (
              <p className="mt-2 text-zinc-600 dark:text-zinc-400">{skillProfileCopy.noFilterMatches}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {visibleSkills.map((skill) => (
                  <li
                    key={skill.treeId}
                    className="flex flex-col gap-2 rounded-lg border border-zinc-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 dark:border-zinc-800"
                  >
                    {readable ? (
                      <SkillRow
                        skill={skill}
                        status={rowStatus[skill.treeId]}
                        locked={resetInProgress}
                        onChangeLevel={(level) => onChangeLevel(skill.treeId, level)}
                      />
                    ) : (
                      <span className="min-w-0 break-words font-medium text-zinc-900 dark:text-zinc-50">{skill.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <p ref={resetStatus} role="status" tabIndex={-1} className="text-sm text-zinc-700 outline-none empty:hidden dark:text-zinc-300">
        {resetState.status === "pending" ? skillProfileCopy.resettingButton : resetDone ? skillProfileCopy.resetDone : null}
      </p>

      {showReset && (
        <ResetAll
          state={resetState}
          disabled={rowSavePending}
          onRequest={onRequestReset}
          onCancel={onCancelReset}
          onConfirm={onConfirmReset}
        />
      )}
    </div>
  );
}

/** Wraps the shared confirmation; focus moves into the confirm step and returns to the trigger on cancel. */
function ResetAll({
  state,
  disabled,
  onRequest,
  onCancel,
  onConfirm,
}: {
  state: DeleteActionState;
  disabled: boolean;
  onRequest: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const previous = useRef(state.status);

  useEffect(() => {
    const buttons = container.current?.querySelectorAll("button");
    if (state.status === "confirming") buttons?.[buttons.length - 1]?.focus();
    if (state.status === "idle" && previous.current === "confirming") buttons?.[0]?.focus();
    previous.current = state.status;
  }, [state.status]);

  return (
    <div ref={container}>
      <DeleteConfirmation
        state={state}
        disabled={disabled}
        deleteLabel={skillProfileCopy.resetButton}
        deletingLabel={skillProfileCopy.resettingButton}
        confirmPrompt={skillProfileCopy.resetConfirmPrompt}
        confirmLabel={skillProfileCopy.resetConfirmLabel}
        cancelLabel={skillProfileCopy.resetCancelLabel}
        onRequestDelete={onRequest}
        onCancelDelete={onCancel}
        onConfirmDelete={onConfirm}
      />
    </div>
  );
}

function FilterControl({ value, onChange }: { value: SkillFilter; onChange: (value: SkillFilter) => void }) {
  const options: { value: SkillFilter; label: string }[] = [
    { value: "all", label: skillProfileCopy.filterAll },
    { value: "assessed", label: skillProfileCopy.filterAssessed },
    { value: "unassessed", label: skillProfileCopy.filterUnassessed },
  ];
  return (
    <fieldset className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      <legend className="sr-only">{skillProfileCopy.filterLegend}</legend>
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-sm text-zinc-900 dark:text-zinc-50">
          <input
            type="radio"
            name="skill-filter"
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

function SkillRow({
  skill,
  status,
  locked,
  onChangeLevel,
}: {
  skill: OwnSkillsDto["skills"][number];
  status: RowStatus | undefined;
  /** True while a reset-all is confirming or pending, so no row write can conflict with it. */
  locked: boolean;
  onChangeLevel: (level: SelfAssessedLevel | null) => void;
}) {
  const pending = status?.kind === "pending";
  return (
    <>
      <div className="min-w-0 break-words sm:max-w-sm sm:flex-1">
        <Select
          id={`skill-level-${skill.treeId}`}
          label={skill.name}
          value={skill.level === null ? "" : String(skill.level)}
          disabled={pending || locked}
          error={status?.kind === "failed" ? status.message : undefined}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === "") return onChangeLevel(null);
            const level = Number(raw);
            if (isSelfAssessedLevel(level)) onChangeLevel(level);
          }}
        >
          <option value="">{skillProfileCopy.unassessed}</option>
          {SELF_ASSESSED_LEVELS.map((level) => (
            <option key={level} value={level}>
              {SELF_ASSESSED_LEVEL_COPY[level].name}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <LevelIndicator level={skill.level} />
        <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
          {pending ? skillProfileCopy.saving : null}
        </p>
      </div>
    </>
  );
}

function Overview({ dto }: { dto: OwnSkillsDto }) {
  const overview = deriveOverview(dto.skills);

  if (overview.assessedCount === 0) {
    return <p className="text-zinc-700 dark:text-zinc-300">{skillProfileCopy.noAssessmentsYet}</p>;
  }

  const levelsWithCounts = SELF_ASSESSED_LEVELS.filter((level) => overview.perLevelCounts[level] > 0);

  return (
    <section aria-labelledby="skill-overview-heading" className="text-zinc-700 dark:text-zinc-300">
      <h2 id="skill-overview-heading" className="sr-only">
        {skillProfileCopy.overviewHeading}
      </h2>
      <p>
        {dto.truncated
          ? skillProfileCopy.assessedOfShown(overview.assessedCount)
          : skillProfileCopy.assessedOfAll(overview.assessedCount, overview.totalCount)}
      </p>
      <ul className="mt-1 text-sm">
        {levelsWithCounts.map((level) => (
          <li key={level}>
            {skillProfileCopy.levelCount(SELF_ASSESSED_LEVEL_COPY[level].name, overview.perLevelCounts[level])}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Four segments filled up to the level, plus the level name as text; the segments carry no meaning on their own. */
function LevelIndicator({ level }: { level: SelfAssessedLevel | null }) {
  return (
    <span className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
      <span aria-hidden="true" className="flex gap-0.5">
        {SELF_ASSESSED_LEVELS.map((segment) => (
          <span
            key={segment}
            className={`h-2 w-4 rounded-sm ${
              level !== null && segment <= level ? "bg-zinc-800 dark:bg-zinc-200" : "bg-zinc-200 dark:bg-zinc-700"
            }`}
          />
        ))}
      </span>
      <span>{level === null ? skillProfileCopy.unassessed : SELF_ASSESSED_LEVEL_COPY[level].name}</span>
    </span>
  );
}
