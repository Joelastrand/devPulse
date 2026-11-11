# Team Survey Builder: Configurable Questions and Templates

## Status
Implemented end to end (TSB-001 to TSB-008; see [TASKS.md](./TASKS.md)).
Product decisions approved in session:

- **Free text** may be published under the privacy contract below.
- **Scheduled opening** is not automatic. `startAt` is informational only, and
  opening is always an explicit admin action.

## Amendment to managed-surveys
Amends [`managed-surveys/SPEC.md`](../managed-surveys/SPEC.md) where it says
question configurability is a non-goal and that the Flow/Stress/Fun set is the
only question format.

- **Superseded:** "Survey question/dimension configurability" as a non-goal;
  "the fixed three-question Flow/Stress/Fun set is the only format"; the
  response payload `[flow, stress, fun]` as the only payload shape.
- **Unchanged:** AES-256-GCM encryption of responses; `public` and
  `authenticated` access modes (fixed at creation); the authenticated
  participation record with no link to response content; `minimumResponses`
  (3–20, immutable) and minimum-response suppression; server-side
  authorization; the one-active-survey-per-team rule; app-admin-only survey
  management (team administrators are not granted survey management).

## Question types
| Type | Answer | Validation |
| --- | --- | --- |
| `rating` | integer 1–5 | exactly one integer in [1, 5] |
| `single_choice` | one option id | id must belong to the question's options |
| `multiple_choice` | set of option ids | unique ids, each belonging to the question's options, at least one if required |
| `free_text` | string | trimmed length ≤ `maxLength` (≤ 1000); always optional |

Every question has a stable `id` (unique within its survey), `prompt`
(1–500 chars) and `required`. Choice questions have 2–10 options, each with a
stable `id` and a `label` (1–200 chars). A survey has 1–20 questions. Ids are
opaque, server-validated identifiers.

## Templates
Built-in templates are read-only definitions in code. Creating a survey from a
template **copies** its definitions. The survey never references the template,
so editing a template cannot affect any existing survey.

- **Team Pulse**: the existing Flow/Stress/Fun rating questions (ids `flow`,
  `stress`, `fun`).
- **Workplace Wellbeing**, **Team Retrospective**, **Skills and Development**:
  Norwegian copy using the question types above.

## Compatibility
- A survey document without a `questions` field is a **legacy survey**. It is
  treated as Team Pulse with the legacy 3-number payload. Legacy documents are
  never rewritten.
- A survey created or upgraded by this feature stores
  `questionSetVersion: 2` and an embedded `questions` array.
- Legacy responses keep the payload `[flow, stress, fun]`. Configurable
  responses use `{"version": 2, "answers": {"<questionId>": ...}}`. The survey,
  not the response, determines the format, so no response record gains a field.
- Encryption, key version, and the response document shape are unchanged.
- Validation of a submission happens after the survey is read, against that
  survey's own question set. An object payload for a legacy survey is converted
  to the legacy array before storage.

## Freezing
- **Draft** (never opened, not archived): title, description, dates, questions,
  options, required flags and order may be edited.
- **Opened, closed or archived:** nothing is editable. The server returns
  `not_editable`. To change a published survey, duplicate it into a new draft.
  The exception is the published-metadata rule below.
- Duplicating copies definitions only, never responses, participations, or
  lifecycle timestamps.

## Draft deletion (approved, implemented)
- An app admin may delete a survey only when it is a **draft**: never opened
  and not archived. The survey must also have **zero stored responses**, checked
  on the server. Otherwise the server refuses with `not_draft` or
  `has_responses`.
- The client asks for confirmation before the request is sent.
- Deletion removes only the survey document. It never touches responses or
  participation records, and it never affects a published or closed survey.
- Endpoint: `DELETE /api/admin/teams/[teamId]/surveys/[surveyId]/draft`.
  Authorization is `requireAppAdmin`, and the team must match the survey.

## Published metadata (approved, implemented)
- After a survey is opened (and before it is archived), an app admin may edit
  **title and description only**.
- Questions, option identities, required flags, access mode, the
  minimum-response threshold, `startAt`, `endAt` and the question-set version
  stay frozen. A patch that touches any of them returns `not_editable`.
- An archived survey is not editable at all.
- The same endpoint as draft editing handles this: `PATCH
  /api/admin/teams/[teamId]/surveys/[surveyId]`. The server decides which
  fields are allowed from the survey's state, not from the client.

## Privacy contract for free text (approved, implemented)
- Free-text questions are always **optional** (`free_text_must_be_optional`).
- Respondents see a warning that their wording may identify them, even in an
  anonymous survey.
- Free-text answers are never returned while a survey is `scheduled` or `open`.
  They are returned only after the survey is closed, the survey reaches its
  `minimumResponses`, and the question itself has at least `minimumResponses`
  answers. Otherwise the question is suppressed.
- Free-text answers carry no timestamp, identity, or ordering.
- **Who may read them: genuine team membership, decided independently of
  app-admin status** (`docs/SECURITY.md` invariant 17). The server checks
  membership in the team with `authorizeTeamMembership`, which does not return
  early for app admins. The rules are:
  - A team member sees the free-text answers, after the publication gate above.
    This includes a member who is also an app admin: that access comes from the
    membership, not the admin role.
  - An app admin who is not a team member sees the question as `restricted`,
    with no text.
  - A caller who is neither a member nor an app admin gets `forbidden` and no
    results at all.
  - A failed membership read is `read_failed`, never a fallback to showing text.
- **Respondent identity:** free-text answers never come with a respondent
  identity, a timestamp, or an ordering. The results response never includes a
  `uid`, e-mail, or membership id next to a free-text answer.
- **Warning:** the results UI repeats the re-identification note on every
  published free-text question, and the restricted marker explains that only
  team members see the text.

## Statistics (implemented)
- Per question: rating mean and 1–5 distribution; single- and multiple-choice
  option counts; free text as above.
- Each question publishes only when it has at least `minimumResponses` answers.
- The survey-level response count appears only once the survey publishes.
- Trends: the existing team trend covers legacy Team Pulse surveys only.
  Configurable surveys are excluded there, so incompatible question sets are
  never combined. **Not implemented:** a trend across configurable surveys with
  identical question definitions. This is the remaining TSB-008 item.

## Scheduled opening (decided: manual only)
A timestamp never opens a survey. `startAt` is shown as a planned date with the
text "Undersøkelsen åpnes ikke automatisk". Opening stays an explicit admin
action, and `open-survey` still enforces one active survey per team.

## Team results page (implemented)
- `/teams/[teamId]/results` adds a **"Spørreundersøkelser"** section after the
  existing Flow/Stress/Fun trend. The trend is unchanged.
- The section lists the team's closed configurable surveys (never drafts, open
  surveys or legacy Team Pulse surveys) through `GET /api/teams/[teamId]/surveys`,
  which returns only title, threshold and close time.
- Each survey's per-question results load on demand from
  `GET /api/teams/[teamId]/surveys/[surveyId]/results`. The UI shows only what
  the server published: rating averages and distributions, option counts, the
  suppressed state, the restricted free-text marker, and the free-text note.
- Loading, empty, and error states are shown for both the list and each
  survey's results.
- No cross-survey trend is added here.

## Known limitations
- Team administrators still can't manage surveys. Management stays app-admin only.
- Trends across configurable-survey versions are not implemented (see Statistics).
- Questions and dates of a published survey can't be changed. Duplicate it to
  make a new version.

## Open decisions
1. Whether team administrators may manage surveys (currently app admins only).
