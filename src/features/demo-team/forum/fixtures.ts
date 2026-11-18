import { validateThreadBody, validateThreadTitle } from "../../forum/domain/thread-content";
import { validateReplyBody } from "../../forum/domain/reply-content";
import { forumThreadContext } from "../../forum/domain/forum-thread";
import { forumReplyContext } from "../../forum/domain/forum-reply";
import { DEMO_MEMBER_IDENTITIES } from "../identities/fixtures";
import type { RecordEnvelope } from "../../../lib/encryption/record-envelope";

/**
 * Team forum activity of the fictional demo team (Phase D). Ten threads and twenty-five replies, all in Norwegian Bokmål,
 * all authored by the ten fictional members (`demo-member-NN`) and never by the presenter. Timestamps are fixed and must lie
 * before the fixture as-of date, so no activity is presented as future.
 *
 * Content refers to the existing demo projects, systems and competence areas by name. Titles and bodies are sealed with the
 * forum's own record codec under the thread's and reply's AAD (`forumThreadContext`, `forumReplyContext`). Nothing here is
 * stored in plaintext.
 */

export interface DemoForumReply {
  replyId: string;
  authorUid: string;
  body: string;
  createdAt: string;
}

export interface DemoForumThread {
  threadId: string;
  authorUid: string;
  title: string;
  body: string;
  createdAt: string;
  replies: readonly DemoForumReply[];
}

export const DEMO_FORUM_THREADS: readonly DemoForumThread[] = Object.freeze([
  {
    threadId: "demo-thread-01",
    authorUid: "demo-member-02",
    title: "Erfaringer med modernisering av interne API-er",
    body: "Vi har nå migrert de to første tjenestene i API-modernisering til versjonerte kontrakter. Tre ting har vært nyttige: å beskrive kontrakten før implementasjon, å bruke felles feilkoder og å la de gamle endepunktene være aktive i en overgangsperiode. Hva har dere gjort?",
    createdAt: "2026-10-06T09:14:00.000Z",
    replies: [
      {
        replyId: "demo-reply-01-01",
        authorUid: "demo-member-03",
        body: "Vi gjorde det samme med datakatalogen. Overgangsperioden var nyttig, men vi burde ha satt en dato for avvikling fra start.",
        createdAt: "2026-10-06T13:02:00.000Z",
      },
      {
        replyId: "demo-reply-01-02",
        authorUid: "demo-member-09",
        body: "Enig. Jeg har skrevet et beslutningsnotat om versjonering av kontrakter. Det ligger i dokumentasjonen og kan brukes som mal for de neste tjenestene.",
        createdAt: "2026-10-07T08:40:00.000Z",
      },
      {
        replyId: "demo-reply-01-03",
        authorUid: "demo-member-02",
        body: "Gode poeng. Jeg legger inn en avviklingsdato i kontraktsbeskrivelsen for neste tjeneste.",
        createdAt: "2026-10-07T10:55:00.000Z",
      },
    ],
  },
  {
    threadId: "demo-thread-02",
    authorUid: "demo-member-09",
    title: "Prioritering av teknisk gjeld",
    body: "Backloggen har nå flere poster om teknisk gjeld enn om ny funksjonalitet. Jeg foreslår at vi setter av fast kapasitet hver sprint og knytter gjelden til konkrete mål i stedet for å ha én stor oppryddingssak. Forslag?",
    createdAt: "2026-10-12T11:30:00.000Z",
    replies: [
      {
        replyId: "demo-reply-02-01",
        authorUid: "demo-member-07",
        body: "Datakatalogen er den største posten for meg. Den eldre datamodellen uten valideringsregler gjør kvalitetskontrollene vanskelige. Kan vi ta den først?",
        createdAt: "2026-10-12T14:20:00.000Z",
      },
      {
        replyId: "demo-reply-02-02",
        authorUid: "demo-member-10",
        body: "Jeg kan støtte fast kapasitet, men vi må være tydelige med interessentene på hva som utsettes. Jeg tar en gjennomgang med dem før neste planlegging.",
        createdAt: "2026-10-13T09:05:00.000Z",
      },
    ],
  },
  {
    threadId: "demo-thread-03",
    authorUid: "demo-member-04",
    title: "Tilgjengelighet i nye digitale tjenester",
    body: "Vi testet to nye skjemaflyter med brukere som bruker skjermleser. Tre funn gikk igjen: feilmeldinger ble ikke lest opp, fokusrekkefølgen var uklar og datovelgeren kunne ikke brukes med tastatur. Skjemamotoren bør få automatiserte tester for dette.",
    createdAt: "2026-10-15T10:00:00.000Z",
    replies: [
      {
        replyId: "demo-reply-03-01",
        authorUid: "demo-member-01",
        body: "Vi kan legge inn automatiske tilgjengelighetstester i Playwright-oppsettet for skjemaene. De fanger de fleste automatiske funnene, men manuell testing må fortsatt gjøres.",
        createdAt: "2026-10-15T12:45:00.000Z",
      },
      {
        replyId: "demo-reply-03-02",
        authorUid: "demo-member-08",
        body: "Jeg setter opp testene i neste sprint. Start gjerne med skjemaene i Skjemamotoren, der feilene har størst effekt.",
        createdAt: "2026-10-16T08:30:00.000Z",
      },
      {
        replyId: "demo-reply-03-03",
        authorUid: "demo-member-04",
        body: "Bra. Jeg lager en kort sjekkliste for manuell test, slik at alle i teamet kan gjøre den.",
        createdAt: "2026-10-16T11:15:00.000Z",
      },
    ],
  },
  {
    threadId: "demo-thread-04",
    authorUid: "demo-member-05",
    title: "Observability og bedre varsling",
    body: "Varslene fra Integrasjonsplattformen kommer ofte for sent, og flere av dem er falske alarmer. Jeg vil gå gjennom varslingsreglene og knytte hvert varsel til en handling i runbooken. Hvem vil være med?",
    createdAt: "2026-10-20T09:50:00.000Z",
    replies: [
      {
        replyId: "demo-reply-04-01",
        authorUid: "demo-member-06",
        body: "Jeg vil gjerne være med, særlig på hvilke varsler som bør gi sikkerhetshendelser. Avvik i tilgangsloggen er ofte signalet vi mangler.",
        createdAt: "2026-10-20T13:10:00.000Z",
      },
      {
        replyId: "demo-reply-04-02",
        authorUid: "demo-member-03",
        body: "Meldingskøene er den ustabile delen. Vi bør måle køvekst og ikke bare feilrate.",
        createdAt: "2026-10-21T07:55:00.000Z",
      },
      {
        replyId: "demo-reply-04-03",
        authorUid: "demo-member-05",
        body: "Godt poeng. Jeg legger inn køvekst som måling i første omgang.",
        createdAt: "2026-10-21T09:20:00.000Z",
      },
    ],
  },
  {
    threadId: "demo-thread-05",
    authorUid: "demo-member-08",
    title: "Teststrategi og automatiserte kvalitetskontroller",
    body: "Rapporteringstjenesten har mange ustabile tester i byggløypa, og det gjør det vanskelig å endre rapportlogikken. Jeg foreslår at vi merker de ustabile testene, gir dem en frist for retting og tar dem ut av blokkerende steg inntil de er stabile.",
    createdAt: "2026-10-27T10:20:00.000Z",
    replies: [
      {
        replyId: "demo-reply-05-01",
        authorUid: "demo-member-07",
        body: "Jeg er enig. Kvaliteten blir ikke bedre av at testene er røde uten at noen vet hvorfor.",
        createdAt: "2026-10-27T15:00:00.000Z",
      },
      {
        replyId: "demo-reply-05-02",
        authorUid: "demo-member-02",
        body: "Jeg kan gå gjennom testene som bruker den delte testdatabasen. Det er en vanlig årsak til ustabilitet.",
        createdAt: "2026-10-28T08:45:00.000Z",
      },
    ],
  },
  {
    threadId: "demo-thread-06",
    authorUid: "demo-member-06",
    title: "Sikker håndtering av integrasjoner",
    body: "Før vi legger til en ny integrasjon mot en ekstern tjeneste vil jeg ha en kort trusselvurdering og en gjennomgang av hemmelighetshåndteringen. Jeg har laget en mal for trusselmodellering. Kan dere se på den?",
    createdAt: "2026-11-02T09:00:00.000Z",
    replies: [
      {
        replyId: "demo-reply-06-01",
        authorUid: "demo-member-09",
        body: "Malen er god. Jeg vil at vi også beskriver hvilke data som sendes, ikke bare hvem som mottar dem.",
        createdAt: "2026-11-02T11:30:00.000Z",
      },
      {
        replyId: "demo-reply-06-02",
        authorUid: "demo-member-02",
        body: "Vi bruker kortlivede tokens i dag. Jeg dokumenterer rotasjonsrutinen i integrasjonsdokumentasjonen.",
        createdAt: "2026-11-03T10:05:00.000Z",
      },
    ],
  },
  {
    threadId: "demo-thread-07",
    authorUid: "demo-member-03",
    title: "Kompetansedeling og faglige samlinger",
    body: "Vi har hatt tre interne workshops denne høsten. Kan vi gjøre dette til en fast månedlig samling? Jeg tenker én time, ett tema og et kort læringsnotat etterpå.",
    createdAt: "2026-11-04T14:00:00.000Z",
    replies: [
      {
        replyId: "demo-reply-07-01",
        authorUid: "demo-member-01",
        body: "Ja, gjerne. Temaet om React fra forrige samling kunne fulgt opp med et par eksempler fra designsystemet.",
        createdAt: "2026-11-04T16:40:00.000Z",
      },
      {
        replyId: "demo-reply-07-02",
        authorUid: "demo-member-10",
        body: "Jeg kan sette opp kalenderen. Vi bør legge samlingen på et tidspunkt som passer alle, også de som jobber deltid.",
        createdAt: "2026-11-05T09:30:00.000Z",
      },
    ],
  },
  {
    threadId: "demo-thread-08",
    authorUid: "demo-member-10",
    title: "Læringspunkter fra en nylig leveranse",
    body: "Leveransen av datakvalitetsprosjektet ble ferdig i tide, men vi endte opp med mange manuelle kontroller etter lansering. Vi må planlegge automatisering tidligere. Hva mener dere?",
    createdAt: "2026-11-06T10:10:00.000Z",
    replies: [
      {
        replyId: "demo-reply-08-01",
        authorUid: "demo-member-07",
        body: "Jeg kom for sent inn i kontrollene. Vi burde hatt dem med i kravene fra starten.",
        createdAt: "2026-11-06T12:25:00.000Z",
      },
      {
        replyId: "demo-reply-08-02",
        authorUid: "demo-member-08",
        body: "Ja, og de manuelle kontrollene burde blitt testet før lansering, ikke etter.",
        createdAt: "2026-11-06T15:50:00.000Z",
      },
      {
        replyId: "demo-reply-08-03",
        authorUid: "demo-member-10",
        body: "Vi tar det med i malen for planleggingsfasen i neste prosjekt.",
        createdAt: "2026-11-07T08:15:00.000Z",
      },
    ],
  },
  {
    threadId: "demo-thread-09",
    authorUid: "demo-member-05",
    title: "Forbedringer i utviklerplattformen",
    body: "Byggtidene har økt de siste to månedene. Jeg har sett på cachingen i byggløypa og tror vi kan halvere tiden for de største tjenestene. Jeg starter med å dokumentere dagens situasjon.",
    createdAt: "2026-11-09T09:45:00.000Z",
    replies: [
      {
        replyId: "demo-reply-09-01",
        authorUid: "demo-member-02",
        body: "Gjerne. Vi kan også se på hvilke steg som kjører unødvendig når endringen bare gjelder dokumentasjon.",
        createdAt: "2026-11-09T13:00:00.000Z",
      },
      {
        replyId: "demo-reply-09-02",
        authorUid: "demo-member-05",
        body: "Godt forslag. Jeg tar det med i beskrivelsen av prosjektet for utviklerplattformen.",
        createdAt: "2026-11-10T08:20:00.000Z",
      },
    ],
  },
  {
    threadId: "demo-thread-10",
    authorUid: "demo-member-10",
    title: "Planlegging av kommende teamaktiviteter",
    body: "Vi trenger en plan for vinteren: fagsamlinger, retrospektiver og tid til arbeid med tilgjengelighet og sikkerhet. Har dere ønsker?",
    createdAt: "2026-11-12T10:00:00.000Z",
    replies: [
      {
        replyId: "demo-reply-10-01",
        authorUid: "demo-member-04",
        body: "Jeg ønsker en tilgjengelighetsdag der vi tester tjenestene sammen med hjelpemidler.",
        createdAt: "2026-11-12T11:45:00.000Z",
      },
      {
        replyId: "demo-reply-10-02",
        authorUid: "demo-member-06",
        body: "En sikkerhetsgjennomgang av integrasjonene kunne vært en del av samme dag.",
        createdAt: "2026-11-12T14:05:00.000Z",
      },
      {
        replyId: "demo-reply-10-03",
        authorUid: "demo-member-09",
        body: "Det høres bra ut. Jeg lager en kort oversikt over de faste punktene.",
        createdAt: "2026-11-13T09:10:00.000Z",
      },
    ],
  },
]);

/** The persisted `forumThreads/{threadId}` document: metadata plaintext, title and body sealed under the thread's AAD. */
export interface ForumThreadDocument {
  teamId: string;
  authorUid: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: RecordEnvelope["keyVersion"];
  keyId: RecordEnvelope["keyId"];
  createdAt: Date;
}

/** The persisted `forumReplies/{replyId}` document: metadata plaintext, body sealed under the reply's AAD. */
export interface ForumReplyDocument {
  teamId: string;
  threadId: string;
  authorUid: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: RecordEnvelope["keyVersion"];
  keyId: RecordEnvelope["keyId"];
  createdAt: Date;
}

export type ForumSealer = (plaintext: string, context: string) => RecordEnvelope;

export function buildForumThreadDocument(thread: DemoForumThread, teamId: string, seal: ForumSealer): ForumThreadDocument {
  const envelope = seal(JSON.stringify({ title: thread.title, body: thread.body }), forumThreadContext(teamId, thread.threadId));
  return {
    teamId,
    authorUid: thread.authorUid,
    ciphertext: envelope.ciphertext,
    iv: envelope.iv,
    authTag: envelope.authTag,
    keyVersion: envelope.keyVersion,
    keyId: envelope.keyId,
    createdAt: new Date(thread.createdAt),
  };
}

export function buildForumReplyDocument(
  reply: DemoForumReply,
  thread: DemoForumThread,
  teamId: string,
  seal: ForumSealer,
): ForumReplyDocument {
  const envelope = seal(reply.body, forumReplyContext(teamId, thread.threadId, reply.replyId));
  return {
    teamId,
    threadId: thread.threadId,
    authorUid: reply.authorUid,
    ciphertext: envelope.ciphertext,
    iv: envelope.iv,
    authTag: envelope.authTag,
    keyVersion: envelope.keyVersion,
    keyId: envelope.keyId,
    createdAt: new Date(reply.createdAt),
  };
}

export interface ForumFixtureProblem {
  category:
    | "thread-id"
    | "reply-id"
    | "duplicate-id"
    | "author"
    | "presenter-author"
    | "title"
    | "body"
    | "timestamp-order"
    | "future-timestamp"
    | "count";
  subject: string;
}

const DOC_ID_PATTERN = /^demo-(thread|reply)-\d{2}(-\d{2})?$/;

/**
 * Offline validation of the forum fixtures (never throws). Checks the counts, id shape and uniqueness, that every author is
 * one of the fictional members (never the presenter), the forum's own title and body rules, that a reply is not older than
 * its thread, and that no timestamp lies after the as-of date.
 */
export function validateDemoForumThreads(
  threads: readonly DemoForumThread[] = DEMO_FORUM_THREADS,
  asOf: Date,
  presenterUid?: string,
): ForumFixtureProblem[] {
  const problems: ForumFixtureProblem[] = [];
  const memberUids = new Set(DEMO_MEMBER_IDENTITIES.map((identity) => identity.uid));
  const threadCount = threads.length;
  const replyCount = threads.reduce((sum, thread) => sum + thread.replies.length, 0);
  if (threadCount < 8 || threadCount > 12) problems.push({ category: "count", subject: "threads" });
  if (replyCount < 20 || replyCount > 30) problems.push({ category: "count", subject: "replies" });

  const threadIds = new Set<string>();
  const replyIds = new Set<string>();
  const checkAuthor = (uid: string) => {
    if (presenterUid !== undefined && uid === presenterUid) problems.push({ category: "presenter-author", subject: uid });
    else if (!memberUids.has(uid)) problems.push({ category: "author", subject: uid });
  };
  const checkTime = (iso: string, subject: string, notBefore?: string) => {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return problems.push({ category: "timestamp-order", subject });
    if (at.getTime() > asOf.getTime()) problems.push({ category: "future-timestamp", subject });
    if (notBefore !== undefined && at.getTime() < new Date(notBefore).getTime()) {
      problems.push({ category: "timestamp-order", subject });
    }
  };

  for (const thread of threads) {
    if (!DOC_ID_PATTERN.test(thread.threadId)) problems.push({ category: "thread-id", subject: thread.threadId });
    if (threadIds.has(thread.threadId)) problems.push({ category: "duplicate-id", subject: thread.threadId });
    threadIds.add(thread.threadId);
    checkAuthor(thread.authorUid);
    if (!validateThreadTitle(thread.title).ok) problems.push({ category: "title", subject: thread.threadId });
    if (!validateThreadBody(thread.body).ok) problems.push({ category: "body", subject: thread.threadId });
    checkTime(thread.createdAt, thread.threadId);

    for (const reply of thread.replies) {
      if (!DOC_ID_PATTERN.test(reply.replyId)) problems.push({ category: "reply-id", subject: reply.replyId });
      if (replyIds.has(reply.replyId)) problems.push({ category: "duplicate-id", subject: reply.replyId });
      replyIds.add(reply.replyId);
      checkAuthor(reply.authorUid);
      if (!validateReplyBody(reply.body).ok) problems.push({ category: "body", subject: reply.replyId });
      checkTime(reply.createdAt, reply.replyId, thread.createdAt);
    }
  }
  return problems;
}
