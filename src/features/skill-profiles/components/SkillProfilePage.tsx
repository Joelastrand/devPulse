"use client";
import { ChartColumn, Sprout, Target } from "lucide-react";
import { StatTile } from "../../../components/ui/dashboard/DashboardPrimitives";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { DeleteConfirmation, type DeleteActionState } from "../../forum/components/DeleteConfirmation";
import { TeamSkillRatingControl } from "../../team-owned-skills/components/TeamSkillRatingControl";
import {
  clearOwnSkillLevel,
  deleteOwnSkillProfile,
  fetchOwnSkills,
  setOwnSkillLevel,
} from "../client/skill-profile-gateway";
import { SELF_ASSESSED_LEVELS, type SelfAssessedLevel } from "../domain/self-assessed-level";
import { deriveOverview, type OwnSkillsDto } from "../domain/skill-profile-view";
import { SELF_ASSESSED_LEVEL_COPY, skillDashboardCopy, skillProfileCopy } from "../copy";

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
 * The signed-in person's own skill list (docs/archive/features/individual-
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
    return <StackedWithSide><LoadingState label={skillProfileCopy.loading} /></StackedWithSide>;
  }

  if (state.phase === "signed_out") {
    return (
      <StackedWithSide>
        <p className="text-zinc-600 dark:text-zinc-400">
          <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
            {skillProfileCopy.signInLink}
          </Link>{" "}
          {skillProfileCopy.signInPrompt}
        </p>
      </StackedWithSide>
    );
  }

  if (state.phase === "load_error") {
    const { token, generation } = state;
    return (
      <StackedWithSide>
        <div className="flex flex-col items-start gap-3">
          <Alert variant="error">{skillProfileCopy.loadError}</Alert>
          <Button variant="secondary" size="sm" onClick={() => handleRetry(token, generation)}>
            {skillProfileCopy.retryButton}
          </Button>
        </div>
      </StackedWithSide>
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

function StackedWithSide({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
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

  const sameNamePosition = sameNamePositions(dto.skills);
  const visibleSkills = dto.skills.filter(
    (skill) => filter === "all" || (filter === "assessed" ? skill.level !== null : skill.level === null),
  );

  return (
    <div className="flex flex-col gap-6">
      {readable && dto.skills.length > 0 ? <SummaryCards dto={dto} /> : null}

      {!readable && <Alert variant="error">{skillProfileCopy.unreadableNotice}</Alert>}
      {dto.truncated && <Alert variant="info">{skillProfileCopy.truncatedNotice}</Alert>}

      {dto.skills.length === 0 ? (
        <EmptyState>{skillProfileCopy.noSkillsDefined}</EmptyState>
      ) : (
        /* One canonical list (BR-29): level bars, text level and the level control per skill. */
        <div className="flex flex-col gap-6">
          <Card as="section" padding="sm" id="rediger" aria-labelledby="skill-list-heading" className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 id="skill-list-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {skillProfileCopy.skillsHeading}
              </h2>
              {readable && <FilterControl value={filter} onChange={setFilter} />}
            </div>
                  <LevelLegend />
            {readable && dto.skills.every((skill) => skill.level === null) ? (
              <p className="text-sm text-text-secondary">{skillProfileCopy.noAssessmentsYet}</p>
            ) : null}
            {visibleSkills.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-400">{skillProfileCopy.noFilterMatches}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border-subtle">
                {visibleSkills.map((skill) => (
                  <li key={skill.treeId} className="py-3">
                    {readable ? (
                      <SkillRow
                        skill={skill}
                        sameName={sameNamePosition.get(skill.treeId) ?? null}
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
          </Card>
        </div>
      )}

      <Card variant="nested" padding="sm" className="flex flex-col gap-1 text-sm text-text-secondary">
        <p>{skillProfileCopy.privacyNotice}</p>
      </Card>

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
        <label
          key={option.value}
          className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
            value === option.value
              ? "border-primary bg-primary-subtle font-medium text-text-primary"
              : "border-border-subtle text-text-secondary"
          }`}
        >
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
  sameName,
  status,
  locked,
  onChangeLevel,
}: {
  skill: OwnSkillsDto["skills"][number];
  /** Position among skills that share this name; null when the name is unique. */
  sameName: { index: number; total: number } | null;
  status: RowStatus | undefined;
  /** True while a reset-all is confirming or pending, so no row write can conflict with it. */
  locked: boolean;
  onChangeLevel: (level: SelfAssessedLevel | null) => void;
}) {
  const pending = status?.kind === "pending";
  const disabled = pending || locked;
  // One level line per row; the rating control carries the selected value, so no second indicator repeats it. Selecting the
  // current level is a no-op. "Fjern vurdering" is a labelled action shown only when a level is set.
  const levelText =
    skill.level === null
      ? skillProfileCopy.unassessed
      : skillProfileCopy.levelSummary(skill.level, SELF_ASSESSED_LEVEL_COPY[skill.level].name);
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="min-w-0 break-words font-medium text-zinc-900 dark:text-zinc-50">{skill.name}</p>
        {sameName ? <p className="text-xs text-text-secondary">{skillProfileCopy.sameNameHint(sameName.index, sameName.total)}</p> : null}
        <p className="text-sm text-text-secondary">{levelText}</p>
        {pending ? (
          <p role="status" className="text-sm text-text-secondary">
            {skillProfileCopy.saving}
          </p>
        ) : null}
        {status?.kind === "failed" ? <Alert variant="error" className="text-sm">{status.message}</Alert> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
        <TeamSkillRatingControl
          skillName={skill.name}
          value={skill.level}
          disabled={disabled}
          onSelect={(level) => {
            if (level !== skill.level) onChangeLevel(level);
          }}
        />
        {skill.level !== null ? (
          <Button size="sm" variant="tertiary" disabled={disabled} onClick={() => onChangeLevel(null)}>
            {skillProfileCopy.clearRating}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Position of each skill among skills sharing its name, keyed by treeId. Only names that occur more than once get an entry. */
function sameNamePositions(skills: OwnSkillsDto["skills"]): Map<string, { index: number; total: number }> {
  const totals = new Map<string, number>();
  for (const skill of skills) totals.set(skill.name, (totals.get(skill.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  const positions = new Map<string, { index: number; total: number }>();
  for (const skill of skills) {
    const total = totals.get(skill.name) ?? 1;
    if (total < 2) continue;
    const index = (seen.get(skill.name) ?? 0) + 1;
    seen.set(skill.name, index);
    positions.set(skill.treeId, { index, total });
  }
  return positions;
}

/**
 * Three summary figures (ref 07). Every value is a count over the caller's own assessments. No averages, sums or scores:
 * levels are ordinal (SECURITY invariant 31). "Utviklingsområder" is defined here as assessed at the two lowest levels.
 */
function SummaryCards({ dto }: { dto: OwnSkillsDto }) {
  const overview = deriveOverview(dto.skills);
  const atOrAboveThree = dto.skills.filter((skill) => skill.level !== null && skill.level >= 3).length;
  const developmentAreas = dto.skills.filter((skill) => skill.level !== null && skill.level <= 2).length;

  return (
    <section aria-labelledby="skill-summary-heading" className="flex flex-col gap-3">
      <h2 id="skill-summary-heading" className="sr-only">
        {skillDashboardCopy.summaryHeading}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        <li>
          <StatTile
            icon={Target}
            label={skillDashboardCopy.developmentLabel}
            value={String(atOrAboveThree)}
            detail={skillDashboardCopy.developmentDetail}
          />
        </li>
        <li>
          <StatTile
            icon={ChartColumn}
            label={skillDashboardCopy.assessedLabel}
            value={dto.truncated ? String(overview.assessedCount) : `${overview.assessedCount} av ${overview.totalCount}`}
            detail={dto.truncated ? skillDashboardCopy.shownDetail : undefined}
          />
        </li>
        <li>
          <StatTile
            icon={Sprout}
            label={skillDashboardCopy.areasLabel}
            value={String(developmentAreas)}
            detail={skillDashboardCopy.areasDetail}
          />
        </li>
      </ul>
    </section>
  );
}

/**
 * The four canonical levels with their full wording (BR-30 "level descriptions"). Collapsed by default to keep the list
 * compact; the rating buttons carry the same names in their accessible labels, so nothing depends on opening it.
 */
function LevelLegend() {
  return (
    <details className="rounded-md border border-border-subtle p-3">
      <summary className="cursor-pointer text-sm font-medium text-text-primary">{skillProfileCopy.legendHeading}</summary>
      <dl className="mt-2 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        {SELF_ASSESSED_LEVELS.map((level) => (
          <div key={level}>
            <dt className="font-medium text-zinc-900 dark:text-zinc-50">{SELF_ASSESSED_LEVEL_COPY[level].name}</dt>
            <dd className="text-zinc-600 dark:text-zinc-400">{SELF_ASSESSED_LEVEL_COPY[level].description}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

