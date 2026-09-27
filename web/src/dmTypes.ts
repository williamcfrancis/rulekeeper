export type Character = {
  id: string;
  name: string;
  ancestry: string;
  class_name: string;
  level: number;
  hp: number;
  max_hp: number;
  armor_class: number;
  notes: string;
};

export type RollRequest = {
  label: string;
  notation: string;
  mode: "normal" | "advantage" | "disadvantage";
  reason: string;
};

export type RollResult = {
  request: RollRequest;
  rolls: number[];
  kept: number[];
  modifier: number;
  total: number;
};

export type JournalEntry = { role: "player" | "dm"; text: string };

export type Campaign = {
  id: string;
  title: string;
  premise: string;
  tone: string;
  characters: Character[];
  location: string;
  summary: string;
  quests: string[];
  npcs: string[];
  inventory: string[];
  turn_count: number;
  history: JournalEntry[];
  pending_roll: RollRequest | null;
};

export type Evidence = {
  id: string;
  title: string;
  category: string;
  text: string;
  page_start: number;
  page_end: number;
  edition: string;
  source_url: string;
  citation: number;
  score: number;
  lexical_score: number;
  dense_score: number;
  rerank_score: number | null;
};

export type DMTurnResponse = {
  campaign: Campaign;
  narration: string;
  rulings: { text: string; citations: number[] }[];
  evidence: Evidence[];
  roll: RollResult | null;
  usage: Record<string, unknown>;
  model: string;
};

export type TurnNotes = Pick<
  DMTurnResponse,
  "rulings" | "evidence" | "roll" | "usage" | "model"
>;

export type SavedTable = {
  version: 1;
  campaign: Campaign;
  notes: Record<string, TurnNotes>;
  pendingRoll: RollResult | null;
};

const invalid = () => {
  throw new Error("This file is not a valid RuleKeeper campaign.");
};
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();
const string = (value: unknown, max: number, min = 0): string =>
  typeof value === "string" &&
  value.trim().length >= min &&
  value.trim().length <= max
    ? value.trim()
    : invalid();
const integer = (value: unknown, min: number, max: number): number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max
    ? value
    : invalid();
const list = <T>(
  value: unknown,
  max: number,
  parse: (item: unknown) => T,
): T[] =>
  Array.isArray(value) && value.length <= max ? value.map(parse) : invalid();

export function parseRollRequest(value: unknown): RollRequest {
  const item = record(value);
  const mode = string(item.mode, 20);
  if (!["normal", "advantage", "disadvantage"].includes(mode)) invalid();
  const request = {
    label: string(item.label, 120, 1),
    notation: string(item.notation, 40, 1),
    mode: mode as RollRequest["mode"],
    reason: string(item.reason, 1000, 1),
  };
  const match = /^([1-9][0-9]?)d(4|6|8|10|12|20|100)([+-][0-9]{1,3})?$/.exec(
    request.notation,
  );
  if (!match || Number(match[1]) > 20 || Math.abs(Number(match[3] || 0)) > 100)
    invalid();
  if (
    request.mode !== "normal" &&
    (Number(match![1]) !== 1 || Number(match![2]) !== 20)
  )
    invalid();
  return request;
}

export function parseRollResult(value: unknown): RollResult {
  const item = record(value);
  const roll = {
    request: parseRollRequest(item.request),
    rolls: list(item.rolls, 20, (n) => integer(n, 1, 100)),
    kept: list(item.kept, 20, (n) => integer(n, 1, 100)),
    modifier: integer(item.modifier, -100, 100),
    total: integer(item.total, -99, 2100),
  };
  const match = /^([1-9][0-9]?)d(4|6|8|10|12|20|100)([+-][0-9]{1,3})?$/.exec(
    roll.request.notation,
  )!;
  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = Number(match[3] || 0);
  const kept =
    roll.request.mode === "advantage"
      ? [Math.max(...roll.rolls)]
      : roll.request.mode === "disadvantage"
        ? [Math.min(...roll.rolls)]
        : roll.rolls;
  if (
    roll.rolls.length !== (roll.request.mode === "normal" ? count : 2) ||
    roll.rolls.some((die) => die > sides)
  )
    invalid();
  if (
    JSON.stringify(roll.kept) !== JSON.stringify(kept) ||
    modifier !== roll.modifier ||
    roll.total !== kept.reduce((sum, die) => sum + die, modifier)
  )
    invalid();
  return roll;
}

export function parseCampaign(value: unknown): Campaign {
  const item = record(value);
  const characters = list(item.characters, 6, (value) => {
    const hero = record(value);
    const max_hp = integer(hero.max_hp, 1, 999);
    return {
      id: string(hero.id, 100, 1),
      name: string(hero.name, 80, 1),
      ancestry: string(hero.ancestry, 80),
      class_name: string(hero.class_name, 80),
      level: integer(hero.level, 1, 20),
      hp: integer(hero.hp, 0, max_hp),
      max_hp,
      armor_class: integer(hero.armor_class, 0, 40),
      notes: string(hero.notes, 1500),
    };
  });
  if (
    !characters.length ||
    new Set(characters.map((hero) => hero.id)).size !== characters.length
  )
    invalid();
  return {
    id: string(item.id, 100, 1),
    title: string(item.title, 100, 1),
    premise: string(item.premise, 3000, 1),
    tone: string(item.tone, 100, 1),
    characters,
    location: string(item.location, 200),
    summary: string(item.summary, 4000),
    quests: list(item.quests, 20, (value) => string(value, 300, 1)),
    npcs: list(item.npcs, 20, (value) => string(value, 300, 1)),
    inventory: list(item.inventory, 20, (value) => string(value, 300, 1)),
    turn_count: integer(item.turn_count, 0, 100000),
    history: list(item.history, 200, (value) => {
      const entry = record(value);
      if (entry.role !== "player" && entry.role !== "dm") invalid();
      return {
        role: entry.role as JournalEntry["role"],
        text: string(entry.text, 6000, 1),
      };
    }),
    pending_roll:
      item.pending_roll === null ? null : parseRollRequest(item.pending_roll),
  };
}

function parseNotes(value: unknown): TurnNotes {
  const item = record(value);
  return {
    model: string(item.model, 100),
    roll: item.roll === null ? null : parseRollResult(item.roll),
    usage: Object.fromEntries(
      Object.entries(record(item.usage))
        .filter(
          ([key, value]) =>
            /^[a-z_]{1,50}$/.test(key) &&
            typeof value === "number" &&
            Number.isFinite(value),
        )
        .slice(0, 20),
    ),
    rulings: list(item.rulings, 20, (value) => {
      const ruling = record(value);
      return {
        text: string(ruling.text, 3000),
        citations: list(ruling.citations, 20, (value) =>
          integer(value, 1, 100),
        ),
      };
    }),
    evidence: list(item.evidence, 20, (value) => {
      const source = record(value);
      return {
        id: string(source.id, 200, 1),
        title: string(source.title, 300),
        category: string(source.category, 100),
        text: string(source.text, 20000),
        page_start: integer(source.page_start, 1, 10000),
        page_end: integer(source.page_end, 1, 10000),
        edition: string(source.edition, 40),
        source_url: string(source.source_url, 1000),
        citation: integer(source.citation, 1, 100),
        score: typeof source.score === "number" ? source.score : 0,
        lexical_score:
          typeof source.lexical_score === "number" ? source.lexical_score : 0,
        dense_score:
          typeof source.dense_score === "number" ? source.dense_score : 0,
        rerank_score:
          typeof source.rerank_score === "number" ? source.rerank_score : null,
      };
    }),
  };
}

export function parseSavedTable(value: unknown): SavedTable {
  const item = record(value);
  if (item.version !== 1) invalid();
  const campaign = parseCampaign(item.campaign);
  const pendingRoll =
    item.pendingRoll === null ? null : parseRollResult(item.pendingRoll);
  if (
    pendingRoll &&
    JSON.stringify(pendingRoll.request) !==
      JSON.stringify(campaign.pending_roll)
  )
    invalid();
  const notes = Object.fromEntries(
    Object.entries(record(item.notes))
      .slice(-100)
      .map(([key, value]) => {
        if (!/^\d{1,6}$/.test(key)) invalid();
        return [key, parseNotes(value)];
      }),
  );
  return {
    version: 1,
    campaign,
    notes,
    pendingRoll,
  };
}
