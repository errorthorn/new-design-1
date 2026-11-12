// Plan-generation logic for the Study Planner. Kept framework-free (no
// React) so it's easy to unit-test and reuse from both the wizard and the
// generated plan view.

export type SkillId =
  | "fluency"
  | "lexical"
  | "grammar"
  | "pronunciation"
  | "examStrategy";

export type Topic = {
  id: string;
  label: string;
};

export type SkillArea = {
  id: SkillId;
  label: string;
  short: string;
  description: string;
  topics: Topic[];
  colorClass: string; // badge classes for calendar chips
};

export const SKILL_AREAS: SkillArea[] = [
  {
    id: "fluency",
    label: "Fluency & Coherence",
    short: "Fluency",
    description: "Speaking smoothly, at length, without losing the thread.",
    colorClass:
      "bg-leaf-500/15 text-leaf-700 dark:bg-leaf-500/20 dark:text-leaf-400",
    topics: [
      { id: "flu_pauses", label: "Speaking without long pauses" },
      { id: "flu_linking", label: "Linking ideas smoothly" },
      { id: "flu_extending", label: "Extending answers naturally" },
      { id: "flu_fillers", label: "Cutting down filler words" },
      { id: "flu_topic_dev", label: "Topic development & staying on track" },
      { id: "flu_self_correct", label: "Self-correcting without breaking flow" },
      { id: "flu_part2_structure", label: "Structuring a 2-minute answer (Part 2)" },
      { id: "flu_part3_opinion", label: "Justifying opinions at length (Part 3)" },
      { id: "flu_storytelling", label: "Storytelling & narrative flow" },
      { id: "flu_turn_taking", label: "Natural turn-taking & pacing" },
    ],
  },
  {
    id: "lexical",
    label: "Lexical Resource",
    short: "Vocabulary",
    description: "Vocabulary range, precision, and natural word choice.",
    colorClass:
      "bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400",
    topics: [
      { id: "lex_topic_vocab", label: "Topic-specific vocabulary" },
      { id: "lex_paraphrase", label: "Paraphrasing (avoiding repeated words)" },
      { id: "lex_idioms", label: "Idiomatic expressions & collocations" },
      { id: "lex_synonyms", label: "Synonyms & word families" },
      { id: "lex_descriptive", label: "Descriptive language" },
      { id: "lex_academic", label: "Academic/formal vocabulary (Part 3)" },
      { id: "lex_everyday", label: "Everyday/informal vocabulary (Part 1)" },
      { id: "lex_vocab_battle", label: "Vocab Battle practice" },
    ],
  },
  {
    id: "grammar",
    label: "Grammatical Range & Accuracy",
    short: "Grammar",
    description: "Sentence variety and accuracy under speaking pressure.",
    colorClass:
      "bg-purple-500/15 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400",
    topics: [
      { id: "gram_tenses", label: "Tenses (present, past, future, perfect)" },
      { id: "gram_conditionals", label: "Conditionals (zero to mixed)" },
      { id: "gram_passive", label: "Passive voice" },
      { id: "gram_reported_speech", label: "Reported / indirect speech" },
      { id: "gram_relative_clauses", label: "Relative clauses" },
      { id: "gram_comparatives", label: "Comparatives & superlatives" },
      { id: "gram_modals", label: "Modal verbs (possibility, obligation, speculation)" },
      { id: "gram_complex_sentences", label: "Complex & compound sentences" },
      { id: "gram_questions", label: "Question formation" },
      { id: "gram_articles_prepositions", label: "Article & preposition accuracy" },
      { id: "gram_self_correct", label: "Self-correcting grammar mid-sentence" },
      { id: "gram_sentence_openers", label: "Varying sentence openers" },
    ],
  },
  {
    id: "pronunciation",
    label: "Pronunciation",
    short: "Pronunciation",
    description: "Clarity, rhythm, and sound accuracy.",
    colorClass:
      "bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
    topics: [
      { id: "pron_word_stress", label: "Word stress patterns" },
      { id: "pron_sentence_stress", label: "Sentence stress & rhythm" },
      { id: "pron_intonation", label: "Intonation (statements vs questions)" },
      { id: "pron_connected_speech", label: "Connected speech (linking, elision)" },
      { id: "pron_sound_drills", label: "Individual sound drills (minimal pairs)" },
      { id: "pron_weak_forms", label: "Weak forms & the schwa sound" },
      { id: "pron_clarity", label: "Clarity & articulation" },
    ],
  },
  {
    id: "examStrategy",
    label: "Exam Parts & Strategy",
    short: "Strategy",
    description: "Practice built around the real 3-part exam format.",
    colorClass:
      "bg-rose-500/15 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400",
    topics: [
      { id: "exam_part1", label: "Part 1: Familiar topic Q&A" },
      { id: "exam_part2", label: "Part 2: Cue card / long turn" },
      { id: "exam_part3", label: "Part 3: Abstract discussion" },
      { id: "exam_tricky_questions", label: "Handling unfamiliar/tricky questions" },
      { id: "exam_time_management", label: "Time management under exam conditions" },
    ],
  },
];

export const LEVEL_LABELS = ["Needs work", "Okay", "Good", "Strong"] as const;

/**
 * Maps a topic id to the user's current strength level (1..4, 1 = needs
 * work most). A topic id is only present here if the user has selected it
 * to be included in their plan — this doubles as both the "which topics do
 * I want" selection and the "how strong am I at each one" rating.
 */
export type Strengths = Record<string, number>;

/**
 * How long the user wants to spend on each selected topic when it comes up
 * in the plan, in minutes. User-editable per topic (previously the whole
 * day's minutesPerDay was wrongly stamped onto a single topic).
 */
export type TopicDurations = Record<string, number>;

export type PlanGoal = {
  targetBand: number; // e.g. 7.5
  durationDays: number; // total plan length
};

/** A single study session on a given weekday: a specific clock time and a
 * time budget. Multiple sessions can exist on the same day (e.g. a short
 * morning drill + a longer evening block), each with its own time. */
export type Session = {
  id: string;
  time: string; // 24h "HH:MM"
  minutesBudget: number;
};

export type DaySchedule = {
  // 0 = Monday ... 6 = Sunday, matching the M T W T F S S row in the UI
  day: number;
  sessions: Session[];
};

export type PlanSchedule = {
  // Only days the user has configured at least one session for are study
  // days. Rest days simply have no entry (or an entry with no sessions).
  days: DaySchedule[];
};

export type PlanBlock = {
  date: string; // ISO yyyy-mm-dd
  time: string; // "HH:MM" — the session this block was packed into
  sessionId: string;
  skillId: SkillId;
  topicId: string;
  topic: string;
  minutes: number; // this topic's own duration, not the whole session's
};

export type StudyPlan = {
  goal: PlanGoal;
  schedule: PlanSchedule;
  strengths: Strengths;
  topicDurations: TopicDurations;
  blocks: PlanBlock[];
  generatedAt: string;
};

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

// JS Date.getDay() is 0=Sunday..6=Saturday; our UI uses 0=Monday..6=Sunday.
function mondayFirstDay(d: Date) {
  return (d.getDay() + 6) % 7;
}

export function findTopic(topicId: string): { area: SkillArea; topic: Topic } | null {
  for (const area of SKILL_AREAS) {
    const topic = area.topics.find((t) => t.id === topicId);
    if (topic) return { area, topic };
  }
  return null;
}

/** 0=Monday..6=Sunday weekday index for an ISO "yyyy-mm-dd" date string. */
export function weekdayOfIso(iso: string): number {
  return mondayFirstDay(new Date(`${iso}T00:00:00`));
}

/** All sessions configured for a given weekday (0=Monday..6=Sunday), sorted
 * by time. Empty array if the user has no sessions on that day. */
export function sessionsForWeekday(schedule: PlanSchedule, weekday: number): Session[] {
  const day = schedule.days.find((d) => d.day === weekday);
  if (!day) return [];
  return [...day.sessions].sort((a, b) => a.time.localeCompare(b.time));
}

/** Selects every topic across every category at a given starting level. Used
 * as the wizard's default so a first-time user already sees a full, sensible
 * curriculum instead of an empty picker — they can then deselect anything
 * they don't want. */
export function allTopicsAtLevel(level = 2): Strengths {
  const strengths: Strengths = {};
  for (const area of SKILL_AREAS) {
    for (const topic of area.topics) strengths[topic.id] = level;
  }
  return strengths;
}

/** Gives every topic in the list a default duration (in minutes) so the
 * plan has something sensible to pack with before the user customizes any
 * individual topic's duration. */
export function defaultTopicDurations(topicIds: string[], minutes = 20): TopicDurations {
  const out: TopicDurations = {};
  for (const id of topicIds) out[id] = minutes;
  return out;
}

export function selectedTopicCount(strengths: Strengths) {
  return Object.keys(strengths).length;
}

export function makeSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function totalWeeklyMinutes(schedule: PlanSchedule) {
  return schedule.days.reduce(
    (sum, d) => sum + d.sessions.reduce((s, ses) => s + ses.minutesBudget, 0),
    0
  );
}

export function totalWeeklySessions(schedule: PlanSchedule) {
  return schedule.days.reduce((sum, d) => sum + d.sessions.length, 0);
}

export const MIN_TOPIC_MINUTES = 5;

function durationOf(topicId: string, topicDurations: TopicDurations) {
  return Math.max(MIN_TOPIC_MINUTES, topicDurations[topicId] ?? 20);
}

/** Minutes already used by a session's blocks, sum of each block's own
 * duration (not the session's total budget). */
export function sessionUsedMinutes(blocks: PlanBlock[], sessionId: string): number {
  return blocks
    .filter((b) => b.sessionId === sessionId)
    .reduce((sum, b) => sum + b.minutes, 0);
}

/**
 * Applies a manual edit to a generated plan's blocks — used by the plan
 * view so a user can override which topic sits in which session on which
 * day, instead of only accepting the auto-generated rotation.
 *
 * - "update": change an existing block's topic and/or duration.
 * - "remove": drop a block entirely, freeing up its session's time.
 * - "add": insert a new block into a specific date+session, as long as it
 *   fits inside that session's remaining minute budget.
 * - "move": change which date+session an existing block belongs to.
 */
export type PlanEdit =
  | { kind: "update"; blockIndex: number; topicId: string; minutes: number }
  | { kind: "remove"; blockIndex: number }
  | { kind: "add"; date: string; sessionId: string; time: string; topicId: string; minutes: number }
  | { kind: "move"; blockIndex: number; date: string; sessionId: string; time: string };

export function applyPlanEdit(plan: StudyPlan, edit: PlanEdit): StudyPlan {
  const blocks = [...plan.blocks];

  if (edit.kind === "update") {
    const found = findTopic(edit.topicId);
    if (!found) return plan;
    const prev = blocks[edit.blockIndex];
    if (!prev) return plan;
    blocks[edit.blockIndex] = {
      ...prev,
      skillId: found.area.id,
      topicId: edit.topicId,
      topic: found.topic.label,
      minutes: Math.max(MIN_TOPIC_MINUTES, edit.minutes),
    };
  } else if (edit.kind === "remove") {
    blocks.splice(edit.blockIndex, 1);
  } else if (edit.kind === "add") {
    const found = findTopic(edit.topicId);
    if (!found) return plan;
    blocks.push({
      date: edit.date,
      time: edit.time,
      sessionId: edit.sessionId,
      skillId: found.area.id,
      topicId: edit.topicId,
      topic: found.topic.label,
      minutes: Math.max(MIN_TOPIC_MINUTES, edit.minutes),
    });
  } else if (edit.kind === "move") {
    const prev = blocks[edit.blockIndex];
    if (!prev) return plan;
    blocks[edit.blockIndex] = {
      ...prev,
      date: edit.date,
      sessionId: edit.sessionId,
      time: edit.time,
    };
  }

  blocks.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));

  return { ...plan, blocks };
}

/**
 * Builds a weighted rotation of topic ids from strength levels — weaker
 * topics (lower level) appear more times, so they come up more often
 * wherever the rotation is packed into session time.
 */
export function buildWeightedRotation(strengths: Strengths): string[] {
  const selectedTopicIds = Object.keys(strengths).filter((id) => findTopic(id));
  const weight = (level: number) => 5 - level; // level 1 -> 4, level 4 -> 1

  const rotation: string[] = [];
  if (selectedTopicIds.length > 0) {
    const maxWeight = Math.max(...selectedTopicIds.map((id) => weight(strengths[id] ?? 2)));
    for (let round = 0; round < maxWeight; round++) {
      for (const id of selectedTopicIds) {
        if (weight(strengths[id] ?? 2) > round) rotation.push(id);
      }
    }
  }
  return rotation;
}

/** One session slot's assignment inside a single recurring week — a
 * weekday + session, not a calendar date, so it repeats every week of the
 * plan. */
export type TemplateBlock = {
  day: number; // 0 = Monday ... 6 = Sunday
  sessionId: string;
  time: string;
  skillId: SkillId;
  topicId: string;
  topic: string;
  minutes: number;
};

export type WeeklyTemplate = {
  blocks: TemplateBlock[];
};

/**
 * Builds one week's worth of topic placements — the same weighted rotation
 * used by the old day-by-day generator, but packed once across a single
 * week's sessions (ordered by day, then time) instead of continuing on
 * indefinitely across the whole plan. This is what the curriculum step
 * shows and lets the user rearrange directly: which topic sits in which
 * session, on which day of the week. The resulting week then repeats for
 * the length of the plan (see expandTemplateToPlan).
 */
export function generateWeeklyTemplate(
  schedule: PlanSchedule,
  strengths: Strengths,
  topicDurations: TopicDurations
): WeeklyTemplate {
  const rotation = buildWeightedRotation(strengths);
  const blocks: TemplateBlock[] = [];
  if (rotation.length === 0) return { blocks };

  const orderedDays = [...schedule.days]
    .filter((d) => d.sessions.length > 0)
    .sort((a, b) => a.day - b.day);

  let rotationIndex = 0;
  for (const day of orderedDays) {
    const orderedSessions = [...day.sessions].sort((a, b) => a.time.localeCompare(b.time));
    for (const session of orderedSessions) {
      let remaining = session.minutesBudget;
      let attemptsSinceProgress = 0;

      while (remaining > 0 && attemptsSinceProgress < rotation.length) {
        const topicId = rotation[rotationIndex % rotation.length];
        const dur = durationOf(topicId, topicDurations);
        rotationIndex++;

        if (dur <= remaining) {
          const found = findTopic(topicId)!;
          blocks.push({
            day: day.day,
            sessionId: session.id,
            time: session.time,
            skillId: found.area.id,
            topicId,
            topic: found.topic.label,
            minutes: dur,
          });
          remaining -= dur;
          attemptsSinceProgress = 0;
        } else {
          attemptsSinceProgress++;
        }
      }
    }
  }

  return { blocks };
}

/** Minutes already used inside a template session, sum of each block's own
 * duration (not the session's total budget). */
export function templateSessionUsedMinutes(blocks: TemplateBlock[], sessionId: string): number {
  return blocks.filter((b) => b.sessionId === sessionId).reduce((sum, b) => sum + b.minutes, 0);
}

/**
 * Manual edit to a weekly template — this is what the curriculum step's
 * builder applies so the user decides exactly which topic goes in which
 * session, on which day, instead of only accepting the auto-generated fill.
 */
export type TemplateEdit =
  | { kind: "update"; blockIndex: number; topicId: string; minutes: number }
  | { kind: "remove"; blockIndex: number }
  | { kind: "add"; day: number; sessionId: string; time: string; topicId: string; minutes: number };

export function applyTemplateEdit(template: WeeklyTemplate, edit: TemplateEdit): WeeklyTemplate {
  const blocks = [...template.blocks];

  if (edit.kind === "update") {
    const found = findTopic(edit.topicId);
    const prev = blocks[edit.blockIndex];
    if (!found || !prev) return template;
    blocks[edit.blockIndex] = {
      ...prev,
      skillId: found.area.id,
      topicId: edit.topicId,
      topic: found.topic.label,
      minutes: Math.max(MIN_TOPIC_MINUTES, edit.minutes),
    };
  } else if (edit.kind === "remove") {
    blocks.splice(edit.blockIndex, 1);
  } else if (edit.kind === "add") {
    const found = findTopic(edit.topicId);
    if (!found) return template;
    blocks.push({
      day: edit.day,
      sessionId: edit.sessionId,
      time: edit.time,
      skillId: found.area.id,
      topicId: edit.topicId,
      topic: found.topic.label,
      minutes: Math.max(MIN_TOPIC_MINUTES, edit.minutes),
    });
  }

  return { blocks };
}

/**
 * Expands a (possibly hand-edited) weekly template into the full dated
 * plan: every date in the plan's duration gets that date's weekday's
 * template blocks, stamped with its real calendar date.
 */
export function expandTemplateToPlan(
  template: WeeklyTemplate,
  goal: PlanGoal,
  schedule: PlanSchedule,
  strengths: Strengths,
  topicDurations: TopicDurations,
  startDate: Date = new Date()
): StudyPlan {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const blocksByWeekday = new Map<number, TemplateBlock[]>();
  for (const b of template.blocks) {
    if (!blocksByWeekday.has(b.day)) blocksByWeekday.set(b.day, []);
    blocksByWeekday.get(b.day)!.push(b);
  }

  const blocks: PlanBlock[] = [];
  for (let i = 0; i < goal.durationDays; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const dow = mondayFirstDay(date);
    const dayBlocks = blocksByWeekday.get(dow);
    if (!dayBlocks) continue;
    for (const b of dayBlocks) {
      blocks.push({
        date: toIso(date),
        time: b.time,
        sessionId: b.sessionId,
        skillId: b.skillId,
        topicId: b.topicId,
        topic: b.topic,
        minutes: b.minutes,
      });
    }
  }

  blocks.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));

  return {
    goal,
    schedule,
    strengths,
    topicDurations,
    blocks,
    generatedAt: new Date().toISOString(),
  };
}
