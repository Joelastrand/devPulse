import type { SurveyQuestion } from "./question-definitions";

/**
 * Built-in survey templates (docs/archive/features/team-survey-builder/SPEC.md —
 * "Templates"). Each template is a factory, not a shared constant: every call
 * returns a fresh, independent copy, so creating a survey from a template
 * copies its definitions and can never mutate another survey or the template.
 */
export const BUILT_IN_TEMPLATE_IDS = [
  "team-pulse",
  "workplace-wellbeing",
  "team-retrospective",
  "skills-and-development",
] as const;
export type BuiltInTemplateId = (typeof BUILT_IN_TEMPLATE_IDS)[number];

export interface SurveyTemplate {
  id: BuiltInTemplateId;
  name: string;
  description: string;
  questions: SurveyQuestion[];
}

function teamPulseQuestions(): SurveyQuestion[] {
  return [
    {
      id: "flow",
      type: "rating",
      prompt: "Arbeidsflyt og leveransetilfredshet",
      required: true,
    },
    {
      id: "stress",
      type: "rating",
      prompt: "Bærekraftig arbeidsmengde og stress",
      required: true,
    },
    {
      id: "fun",
      type: "rating",
      prompt: "Glede og motivasjon",
      required: true,
    },
  ];
}

function workplaceWellbeingQuestions(): SurveyQuestion[] {
  return [
    {
      id: "energy",
      type: "rating",
      prompt: "Hvordan har du det med energinivået ditt denne perioden?",
      required: true,
    },
    {
      id: "balance",
      type: "rating",
      prompt: "Hvordan opplever du balansen mellom jobb og fritid?",
      required: true,
    },
    {
      id: "support",
      type: "single_choice",
      prompt: "Hvor godt får du støtte fra teamet når du trenger det?",
      required: true,
      options: [
        { id: "very_good", label: "Veldig godt" },
        { id: "good", label: "Godt" },
        { id: "poor", label: "Dårlig" },
        { id: "very_poor", label: "Veldig dårlig" },
      ],
    },
  ];
}

function teamRetrospectiveQuestions(): SurveyQuestion[] {
  return [
    {
      id: "went_well",
      type: "multiple_choice",
      prompt: "Hva fungerte bra i denne perioden?",
      required: false,
      options: [
        { id: "planning", label: "Planlegging" },
        { id: "collaboration", label: "Samarbeid" },
        { id: "delivery", label: "Leveranser" },
        { id: "communication", label: "Kommunikasjon" },
      ],
    },
    {
      id: "improve",
      type: "multiple_choice",
      prompt: "Hva bør vi forbedre?",
      required: false,
      options: [
        { id: "planning", label: "Planlegging" },
        { id: "collaboration", label: "Samarbeid" },
        { id: "delivery", label: "Leveranser" },
        { id: "communication", label: "Kommunikasjon" },
      ],
    },
    {
      id: "action_idea",
      type: "free_text",
      prompt: "Har du et konkret forslag til neste steg?",
      required: false,
      maxLength: 500,
    },
  ];
}

function skillsAndDevelopmentQuestions(): SurveyQuestion[] {
  return [
    {
      id: "growth",
      type: "rating",
      prompt: "Hvor godt får du utvikle deg faglig her?",
      required: true,
    },
    {
      id: "learning_area",
      type: "single_choice",
      prompt: "Hvilket område ønsker du mest å utvikle?",
      required: true,
      options: [
        { id: "technical", label: "Teknisk kompetanse" },
        { id: "process", label: "Arbeidsprosesser" },
        { id: "leadership", label: "Lederskap" },
        { id: "domain", label: "Fagområde" },
      ],
    },
    {
      id: "learning_time",
      type: "rating",
      prompt: "Har du nok tid til læring og utvikling i arbeidshverdagen?",
      required: true,
    },
  ];
}

const TEMPLATE_DEFINITIONS: Record<BuiltInTemplateId, () => Omit<SurveyTemplate, "id">> = {
  "team-pulse": () => ({
    name: "Teampuls",
    description: "De tre faste spørsmålene om flyt, stress og glede.",
    questions: teamPulseQuestions(),
  }),
  "workplace-wellbeing": () => ({
    name: "Arbeidsmiljø og velvære",
    description: "Energi, balanse mellom jobb og fritid, og støtte fra teamet.",
    questions: workplaceWellbeingQuestions(),
  }),
  "team-retrospective": () => ({
    name: "Retrospektiv",
    description: "Hva som fungerte, hva vi bør forbedre, og ett konkret forslag.",
    questions: teamRetrospectiveQuestions(),
  }),
  "skills-and-development": () => ({
    name: "Kompetanse og utvikling",
    description: "Faglig utvikling, prioriterte læringsområder og tid til læring.",
    questions: skillsAndDevelopmentQuestions(),
  }),
};

/** Returns a fresh, independent copy of a built-in template. */
export function getBuiltInTemplate(id: BuiltInTemplateId): SurveyTemplate {
  const definition = TEMPLATE_DEFINITIONS[id];
  return { id, ...definition() };
}

export function listBuiltInTemplates(): SurveyTemplate[] {
  return BUILT_IN_TEMPLATE_IDS.map((id) => getBuiltInTemplate(id));
}

/** Runtime guard for an untrusted template id from a request body. */
export function isBuiltInTemplateId(value: unknown): value is BuiltInTemplateId {
  return typeof value === "string" && (BUILT_IN_TEMPLATE_IDS as readonly string[]).includes(value);
}
