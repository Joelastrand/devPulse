"use client";

import { useRef, useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Select } from "../../../components/ui/Select";
import { TextArea } from "../../../components/ui/TextArea";
import { SELF_ASSESSED_LEVEL_COPY } from "../../skill-profiles/copy";
import { setTeamManualAssessment, clearTeamManualAssessment, type TeamManualAssessmentView, type TeamSkillView } from "../client/team-skills-gateway";
import type { TeamSkillLevel } from "../domain/team-skill";
import { TEAM_MANUAL_NOTE_MAX } from "../domain/team-manual-assessment";
import { teamCompetenceCopy } from "../workspace-copy";

const copy = teamCompetenceCopy.editor;

/**
 * Administrator entry of the team's agreed level per active skill (collaborative profile). Each row saves on its own. An
 * empty level clears the agreed value. Individual assessments are never read or changed here.
 */
export function TeamManualLevelEditor({
  teamId,
  token,
  skills,
  assessments,
  onChanged,
}: {
  readonly teamId: string;
  readonly token: string;
  readonly skills: readonly TeamSkillView[];
  readonly assessments: readonly TeamManualAssessmentView[];
  /** Called only after the server confirms a save. The message is shown by the page, which outlives the reload. */
  readonly onChanged: (message: string) => void;
}) {
  return (
    <section aria-labelledby="team-manual-editor-heading" className="flex flex-col gap-3">
      <h3 id="team-manual-editor-heading" className="text-base font-semibold text-text-primary">
        {copy.heading}
      </h3>
      <p className="text-sm text-text-secondary">{copy.description}</p>
      <ul className="flex flex-col gap-4">
        {skills.map((skill) => (
          <ManualRow
            key={`${skill.skillId}|${assessments.find((a) => a.skillId === skill.skillId)?.updatedAt ?? "none"}`}
            teamId={teamId}
            token={token}
            skill={skill}
            current={assessments.find((a) => a.skillId === skill.skillId) ?? null}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </section>
  );
}

type RowStatus = { kind: "idle" } | { kind: "saving" } | { kind: "denied" } | { kind: "failed" };

function ManualRow({
  teamId,
  token,
  skill,
  current,
  onChanged,
}: {
  readonly teamId: string;
  readonly token: string;
  readonly skill: TeamSkillView;
  readonly current: TeamManualAssessmentView | null;
  readonly onChanged: (message: string) => void;
}) {
  const [level, setLevel] = useState<string>(current === null ? "" : String(current.level));
  const [note, setNote] = useState<string>(current?.note ?? "");
  const [status, setStatus] = useState<RowStatus>({ kind: "idle" });
  const inFlight = useRef(false);
  const selectId = `manual-level-${skill.skillId}`;
  const noteId = `manual-note-${skill.skillId}`;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A ref, not the render-time status: two submits before a re-render still see the first one in flight.
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus({ kind: "saving" });
    try {
      const trimmedNote = note.trim();
      const result =
        level === ""
          ? await clearTeamManualAssessment(token, teamId, skill.skillId)
          : await setTeamManualAssessment(token, teamId, skill.skillId, Number(level) as TeamSkillLevel, trimmedNote === "" ? null : trimmedNote);
      if (result.status !== "ok") {
        // Authorization outcomes are not a network failure: they get their own message and do not invite a retry.
        const denied = result.status === "forbidden" || result.status === "unauthenticated" || result.status === "team_disabled";
        setStatus(denied ? { kind: "denied" } : { kind: "failed" });
        return;
      }
      setStatus({ kind: "idle" });
      onChanged(level === "" ? copy.cleared : copy.saved);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-3">
      <form onSubmit={save} className="flex flex-col gap-3" aria-label={skill.name}>
        <p className="text-sm font-medium text-text-primary">{skill.name}</p>
        <Select
          id={selectId}
          label={copy.level}
          value={level}
          onChange={(event) => {
            setLevel(event.target.value);
            setStatus({ kind: "idle" });
          }}
        >
          <option value="">{copy.none}</option>
          {([1, 2, 3, 4] as const).map((value) => (
            <option key={value} value={value}>
              {`${value} · ${SELF_ASSESSED_LEVEL_COPY[value].name}`}
            </option>
          ))}
        </Select>
        <TextArea
          id={noteId}
          label={copy.note}
          optional
          maxLength={TEAM_MANUAL_NOTE_MAX}
          rows={2}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setStatus({ kind: "idle" });
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" size="sm" disabled={status.kind === "saving"} aria-busy={status.kind === "saving"}>
            {status.kind === "saving" ? copy.saving : copy.save}
          </Button>
          {status.kind === "denied" ? <Alert variant="info">{copy.denied}</Alert> : null}
          {status.kind === "failed" ? <Alert variant="error">{copy.failed}</Alert> : null}
        </div>
      </form>
    </li>
  );
}
