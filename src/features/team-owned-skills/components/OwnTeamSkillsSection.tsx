"use client";

import { useRef, useState } from "react";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchTeamsOverview } from "../../teams/client/teams-overview-gateway";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingRegion, Skeleton } from "../../../components/ui/Skeleton";
import { SELF_ASSESSED_LEVEL_COPY } from "../../skill-profiles/copy";
import { teamSkillsCopy } from "../copy";
import type { TeamSkillLevel } from "../domain/team-skill";
import {
  clearOwnTeamSkillRating,
  fetchTeamSkills,
  setOwnTeamSkillRating,
  type OwnTeamSkillRating,
  type TeamSkillsListResult,
  type TeamSkillView,
} from "../client/team-skills-gateway";
import { TeamSkillRatingControl } from "./TeamSkillRatingControl";

type Filter = "all" | "assessed" | "notAssessed";

interface TeamBlock {
  teamId: string;
  name: string;
  list: TeamSkillsListResult;
  /** Set when the last rating action for this team failed; shown next to the team, never silently dropped. */
  error: string | null;
}

function ratingFor(list: Extract<TeamSkillsListResult, { status: "ok" }>, skillId: string): OwnTeamSkillRating | undefined {
  return list.own.find((rating) => rating.skillId === skillId);
}

/**
 * The personal assessment of team-owned skills, grouped by team (docs/archive/features/team-owned-skills/SPEC.md §8). Team names
 * come from the existing membership overview; only teams the person belongs to are shown. Ratings are written per skill
 * through the server, and the list is reloaded after each change so the stored state is what is shown.
 */
export function OwnTeamSkillsSection() {
  const [blocks, setBlocks] = useState<TeamBlock[] | null>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  /** Rating keys (`teamId:skillId`) with a write in flight. Mirrored in a ref so a repeat click is blocked before re-render. */
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRef = useRef(new Set<string>());
  /** The current identity and its generation. Every late result is checked against the generation it was started under. */
  const current = useRef<{ token: string | null; generation: number; isCurrent: (generation: number) => boolean }>({
    token: null,
    generation: 0,
    isCurrent: () => false,
  });

  useAuthGatedResource((nextToken, generation, isCurrentGeneration) => {
    current.current = { token: nextToken, generation, isCurrent: isCurrentGeneration };
    // A new auth state drops every in-flight rating and the previous identity's blocks.
    pendingRef.current = new Set();
    setPendingKeys(new Set());
    setBlocks(null);
    setOverviewFailed(false);
    if (nextToken === null) {
      setBlocks([]);
      return;
    }
    void (async () => {
      const overview = await fetchTeamsOverview(nextToken);
      if (!isCurrentGeneration(generation)) return;
      if (overview.status !== "ok") {
        setOverviewFailed(true);
        setBlocks([]);
        return;
      }
      const member = overview.teams.filter((team) => team.isMember);
      const loaded = await Promise.all(
        member.map(async (team): Promise<TeamBlock> => ({
          teamId: team.teamId,
          name: team.name,
          list: await fetchTeamSkills(nextToken, team.teamId),
          error: null,
        })),
      );
      if (!isCurrentGeneration(generation)) return;
      setBlocks(loaded);
    })();
  }, []);

  /** Re-reads one team with the identity that is current when called. A result from a superseded generation is dropped. */
  async function reloadTeam(teamId: string, error: string | null) {
    const { token, generation, isCurrent } = current.current;
    if (token === null) return;
    const list = await fetchTeamSkills(token, teamId);
    if (!isCurrent(generation)) return;
    setBlocks((existing) => existing?.map((block) => (block.teamId === teamId ? { ...block, list, error } : block)) ?? null);
  }

  async function rate(teamId: string, skillId: string, level: TeamSkillLevel | null) {
    const key = `${teamId}:${skillId}`;
    const { token, generation, isCurrent } = current.current;
    if (token === null || pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    setPendingKeys(new Set(pendingRef.current));
    try {
      const outcome =
        level === null
          ? await clearOwnTeamSkillRating(token, teamId, skillId)
          : await setOwnTeamSkillRating(token, teamId, skillId, level);
      if (!isCurrent(generation)) {
        // The auth state changed mid-write: no success or failure is shown; the team is re-read for the current identity.
        await reloadTeam(teamId, null);
        return;
      }
      if (outcome.status === "ok") {
        await reloadTeam(teamId, null);
        return;
      }
      const message = (teamSkillsCopy.errors as Record<string, string>)[outcome.status] ?? teamSkillsCopy.errors.write_failed;
      await reloadTeam(teamId, message);
    } finally {
      pendingRef.current.delete(key);
      setPendingKeys(new Set(pendingRef.current));
    }
  }

  if (blocks === null) return <OwnTeamSkillsSkeleton label={teamSkillsCopy.loading} />;
  if (overviewFailed) return <Alert variant="error">{teamSkillsCopy.errors.read_failed}</Alert>;
  if (blocks.length === 0) return <EmptyState>{teamSkillsCopy.own.emptyTeam}</EmptyState>;

  return (
    <section aria-labelledby="own-team-skills-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 id="own-team-skills-heading" className="text-lg font-semibold text-text-primary">
          {teamSkillsCopy.own.heading}
        </h2>
        <p className="text-sm text-text-secondary">{teamSkillsCopy.own.description}</p>
        <FilterButtons value={filter} onChange={setFilter} />
      </div>
      {blocks.map((block) => (
        <TeamBlockView
          key={block.teamId}
          block={block}
          filter={filter}
          pendingKeys={pendingKeys}
          onRate={(skillId, level) => void rate(block.teamId, skillId, level)}
        />
      ))}
    </section>
  );
}

function FilterButtons({ value, onChange }: { value: Filter; onChange: (next: Filter) => void }) {
  const options: Array<{ key: Filter; label: string }> = [
    { key: "all", label: teamSkillsCopy.own.filterAll },
    { key: "assessed", label: teamSkillsCopy.own.filterAssessed },
    { key: "notAssessed", label: teamSkillsCopy.own.filterNotAssessed },
  ];
  return (
    <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          className={
            "min-h-9 rounded-full border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary " +
            (value === option.key ? "border-primary bg-primary text-text-inverse" : "border-border-strong bg-surface text-text-primary")
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Placeholder with the final layout: heading, filter row, one team card with skill rows. Decorative; the region announces once. */
function OwnTeamSkillsSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-4">
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="flex flex-col gap-3 rounded-surface border border-border-subtle bg-surface p-4">
          <Skeleton className="h-5 w-1/4" />
          <ul className="flex flex-col divide-y divide-border-subtle">
            {[0, 1, 2].map((index) => (
              <li key={index} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-8 w-48 md:shrink-0" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </LoadingRegion>
  );
}

function TeamBlockView({
  block,
  filter,
  pendingKeys,
  onRate,
}: {
  block: TeamBlock;
  filter: Filter;
  pendingKeys: ReadonlySet<string>;
  onRate: (skillId: string, level: TeamSkillLevel | null) => void;
}) {
  const heading = teamSkillsCopy.own.teamHeading(block.name);
  if (block.list.status !== "ok") {
    return (
      <Card as="section" padding="sm" variant="bordered" aria-label={heading} className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-text-primary">{heading}</h3>
        <Alert variant="error">{(teamSkillsCopy.errors as Record<string, string>)[block.list.status] ?? teamSkillsCopy.errors.read_failed}</Alert>
      </Card>
    );
  }
  const list = block.list;
  const active = list.skills.filter((skill) => skill.active);
  const inactive = list.skills.filter((skill) => !skill.active);
  const assessed = active.filter((skill) => ratingFor(list, skill.skillId) !== undefined).length;
  const visible = active.filter((skill) => {
    const rated = ratingFor(list, skill.skillId) !== undefined;
    return filter === "all" || (filter === "assessed" ? rated : !rated);
  });

  return (
    <Card as="section" padding="sm" variant="bordered" aria-label={heading} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-text-primary">{heading}</h3>
        <p className="text-sm text-text-secondary">
          {teamSkillsCopy.own.counts(active.length, assessed, active.length - assessed)}
        </p>
      </div>
      {block.error ? <Alert variant="error">{block.error}</Alert> : null}
      {active.length === 0 ? <EmptyState>{teamSkillsCopy.own.emptyTeam}</EmptyState> : null}
      {active.length > 0 && visible.length === 0 ? <p className="text-sm text-text-secondary">{teamSkillsCopy.own.emptyTeam}</p> : null}
      <ul className="flex flex-col divide-y divide-border-subtle">
        {visible.map((skill) => (
          <SkillRatingRow
            key={skill.skillId}
            skill={skill}
            rating={ratingFor(list, skill.skillId)}
            pending={pendingKeys.has(`${block.teamId}:${skill.skillId}`)}
            onRate={(level) => onRate(skill.skillId, level)}
          />
        ))}
      </ul>
      {inactive.length > 0 ? (
        <details className="rounded-md border border-border-subtle p-3">
          <summary className="cursor-pointer text-sm font-medium text-text-primary">{teamSkillsCopy.own.inactiveHeading}</summary>
          <p className="mt-2 text-sm text-text-secondary">{teamSkillsCopy.own.inactiveDescription}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {inactive.map((skill) => {
              const rating = ratingFor(list, skill.skillId);
              return (
                <li key={skill.skillId} className="text-sm text-text-secondary">
                  {skill.name}: {rating ? `${rating.level}. ${SELF_ASSESSED_LEVEL_COPY[rating.level].name}` : teamSkillsCopy.own.notSet}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

function SkillRatingRow({
  skill,
  rating,
  pending,
  onRate,
}: {
  skill: TeamSkillView;
  rating: OwnTeamSkillRating | undefined;
  /** True while this skill's write is in flight: only this row's controls are disabled. */
  pending: boolean;
  onRate: (level: TeamSkillLevel | null) => void;
}) {
  return (
    <li className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <p className="break-words font-medium text-text-primary">{skill.name}</p>
        {skill.category ? <p className="text-xs text-text-secondary">{skill.category}</p> : null}
        {rating?.outdated ? <p className="text-xs font-medium text-text-primary">{teamSkillsCopy.own.outdated}</p> : null}
        <details className="mt-1">
          <summary className="cursor-pointer text-xs font-medium text-text-secondary">{teamSkillsCopy.own.criteriaGuidance}</summary>
          {/* Only the team's own guidance is shown here; the level names are the personal scale's wording. */}
          {Object.keys(skill.guidance).length === 0 ? (
            <p className="mt-1 text-xs text-text-secondary">{teamSkillsCopy.own.criteriaGuidanceNone}</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1 text-xs text-text-secondary">
              {([1, 2, 3, 4] as const).flatMap((level) => {
                const text = skill.guidance[String(level) as "1" | "2" | "3" | "4"];
                return text === undefined ? [] : [
                  <li key={level}>
                    <span className="font-medium">
                      {level}. {SELF_ASSESSED_LEVEL_COPY[level].name}:
                    </span>{" "}
                    {text}
                  </li>,
                ];
              })}
            </ul>
          )}
        </details>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <TeamSkillRatingControl skillName={skill.name} value={rating?.level ?? null} disabled={pending} onSelect={(level) => onRate(level)} />
        {rating ? (
          <Button size="sm" variant="tertiary" disabled={pending} onClick={() => onRate(null)}>
            {teamSkillsCopy.own.clearButton}
          </Button>
        ) : null}
        {pending ? <span className="text-xs text-text-secondary">{teamSkillsCopy.savingButton}</span> : null}
      </div>
    </li>
  );
}
