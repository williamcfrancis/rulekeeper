import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Compass,
  Download,
  Feather,
  Heart,
  KeyRound,
  LoaderCircle,
  MapPin,
  Plus,
  RotateCcw,
  ScrollText,
  Shield,
  SlidersHorizontal,
  Swords,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import type {
  Campaign,
  Character,
  DMTurnResponse,
  Evidence,
  RollResult,
  SavedTable,
  TurnNotes,
} from "./dmTypes";
import { parseCampaign, parseRollResult, parseSavedTable } from "./dmTypes";
import "./dm.css";

const STORAGE_KEY = "rulekeeper-table-v1";
const MODEL = "gpt-5.6-sol";
const MAX_FILE_BYTES = 4_000_000;

function emptyCharacter(): Character {
  return {
    id: crypto.randomUUID(),
    name: "",
    ancestry: "Human",
    class_name: "Fighter",
    level: 1,
    hp: 12,
    max_hp: 12,
    armor_class: 16,
    notes: "",
  };
}

function starterCampaign(): Campaign {
  return {
    id: crypto.randomUUID(),
    title: "The Bell at Blackwater",
    premise:
      "A drowned chapel's bell has begun ringing beneath Blackwater Marsh. Each morning, another villager wakes with a memory that belongs to someone else. The party arrives at the Reed & Lantern inn as the bell tolls for the third night. Discover who is ringing it, and what the marsh is trying to remember.",
    tone: "Folklore mystery, strange but hopeful",
    characters: [
      {
        ...emptyCharacter(),
        name: "Mara Vale",
        armor_class: 18,
        notes:
          "A former town guard carrying a letter from a missing friend. Strength +3, Dexterity +1, Constitution +2, Intelligence +0, Wisdom +1, Charisma -1. Proficiency +2; Athletics +5, Perception +3. Longsword attack +5, damage 1d8+3 slashing. Shield, chain mail, explorer's pack. Editable starter sheet; add other features as needed.",
      },
    ],
    location: "Blackwater Marsh",
    summary: "",
    quests: [],
    npcs: [],
    inventory: [],
    turn_count: 0,
    history: [],
    pending_roll: null,
  };
}

function loadTable(): { table: SavedTable | null; error: string } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { table: null, error: "" };
    if (saved.length > MAX_FILE_BYTES) throw new Error();
    return { table: parseSavedTable(JSON.parse(saved)), error: "" };
  } catch {
    return {
      table: null,
      error:
        "The saved table couldn't be read. Import a campaign backup or prepare a new table.",
    };
  }
}

function DiceMark({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? "dm-die dm-die-small" : "dm-die"}
      viewBox="0 0 100 112"
      fill="none"
      aria-hidden="true"
    >
      <path d="M50 5 91 29 91 79 50 105 9 79 9 29Z" />
      <path d="m50 5 25 59-66-35 82 0-66 35Zm0 100L25 64l66 15M9 79l66-15L50 105M25 64h50L50 21Z" />
      <path d="M9 29 25 64 9 79M91 29 75 64 91 79" />
    </svg>
  );
}

function PlainParagraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
    </>
  );
}

function characterDescription(character: Character) {
  return `Level ${character.level} ${[character.ancestry, character.class_name].filter(Boolean).join(" ")}`;
}

function CharacterFields({
  character,
  index,
  onChange,
  onRemove,
  removable,
}: {
  character: Character;
  index: number;
  onChange: (value: Character) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const update = (field: keyof Character, value: string | number) =>
    onChange({ ...character, [field]: value });
  return (
    <fieldset className="dm-character-fields">
      <legend>
        <span className="dm-ordinal">{String(index + 1).padStart(2, "0")}</span>{" "}
        Adventurer
      </legend>
      {removable && (
        <button
          type="button"
          className="dm-remove-character"
          onClick={onRemove}
          aria-label={`Remove adventurer ${index + 1}`}
        >
          <Trash2 size={15} />
        </button>
      )}
      <label className="dm-field dm-character-name">
        Character name
        <input
          aria-label={`Character ${index + 1} name`}
          value={character.name}
          onChange={(event) => update("name", event.target.value)}
          maxLength={80}
          required
          placeholder="A name for the songs"
        />
      </label>
      <div className="dm-fields-row dm-character-identity">
        <label className="dm-field">
          Ancestry
          <input
            aria-label={`Character ${index + 1} ancestry`}
            value={character.ancestry}
            onChange={(event) => update("ancestry", event.target.value)}
            maxLength={80}
          />
        </label>
        <label className="dm-field">
          Class
          <input
            aria-label={`Character ${index + 1} class`}
            value={character.class_name}
            onChange={(event) => update("class_name", event.target.value)}
            maxLength={80}
          />
        </label>
        <label className="dm-field">
          Level
          <input
            aria-label={`Character ${index + 1} level`}
            type="number"
            min={1}
            max={20}
            value={character.level}
            onChange={(event) => update("level", Number(event.target.value))}
            required
          />
        </label>
      </div>
      <div className="dm-fields-row dm-character-vitals">
        <label className="dm-field">
          Hit points
          <input
            aria-label={`Character ${index + 1} hit points`}
            type="number"
            min={0}
            max={character.max_hp}
            value={character.hp}
            onChange={(event) => update("hp", Number(event.target.value))}
            required
          />
        </label>
        <label className="dm-field">
          Max HP
          <input
            aria-label={`Character ${index + 1} maximum hit points`}
            type="number"
            min={1}
            max={999}
            value={character.max_hp}
            onChange={(event) => update("max_hp", Number(event.target.value))}
            required
          />
        </label>
        <label className="dm-field">
          Armor class
          <input
            aria-label={`Character ${index + 1} armor class`}
            type="number"
            min={0}
            max={40}
            value={character.armor_class}
            onChange={(event) =>
              update("armor_class", Number(event.target.value))
            }
            required
          />
        </label>
      </div>
      <label className="dm-field">
        Abilities, equipment & backstory
        <textarea
          aria-label={`Character ${index + 1} notes`}
          value={character.notes}
          onChange={(event) => update("notes", event.target.value)}
          maxLength={1500}
          rows={3}
          placeholder="Ability modifiers, spells, equipment, and anything the DM should remember."
        />
      </label>
    </fieldset>
  );
}

function CampaignFields({
  draft,
  setDraft,
  partyOnly = false,
}: {
  draft: Campaign;
  setDraft: (value: Campaign) => void;
  partyOnly?: boolean;
}) {
  return (
    <>
      {!partyOnly && (
        <>
          <label className="dm-field">
            Campaign title
            <input
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
              maxLength={100}
              required
            />
          </label>
          <label className="dm-field">
            Adventure premise
            <textarea
              value={draft.premise}
              onChange={(event) =>
                setDraft({ ...draft, premise: event.target.value })
              }
              maxLength={3000}
              rows={5}
              required
            />
            <span className="dm-field-hint">
              Set the place, the problem, and what brings your party together.
            </span>
          </label>
          <label className="dm-field">
            Table tone
            <input
              value={draft.tone}
              onChange={(event) =>
                setDraft({ ...draft, tone: event.target.value })
              }
              maxLength={100}
              required
              placeholder="Lighthearted adventure, gothic mystery..."
            />
          </label>
        </>
      )}
      <div className="dm-section-heading">
        <h3>The adventurers</h3>
        <span>{draft.characters.length} / 6 seats</span>
      </div>
      <p className="dm-form-note">
        Use the starter character or bring your own sheet. Include ability
        modifiers and features in the notes so the DM can use them.
      </p>
      <div className="dm-character-list">
        {draft.characters.map((character, index) => (
          <CharacterFields
            key={character.id}
            character={character}
            index={index}
            removable={draft.characters.length > 1}
            onChange={(value) =>
              setDraft({
                ...draft,
                characters: draft.characters.map((current) =>
                  current.id === value.id ? value : current,
                ),
              })
            }
            onRemove={() =>
              setDraft({
                ...draft,
                characters: draft.characters.filter(
                  (current) => current.id !== character.id,
                ),
              })
            }
          />
        ))}
      </div>
      <button
        type="button"
        className="dm-text-button dm-add-character"
        onClick={() =>
          setDraft({
            ...draft,
            characters: [...draft.characters, emptyCharacter()],
          })
        }
        disabled={draft.characters.length >= 6}
      >
        <Plus size={16} /> Add an adventurer
      </button>
    </>
  );
}

function DiceResult({ roll }: { roll: RollResult }) {
  return (
    <div className="dm-dice-result">
      <DiceMark small />
      <div>
        <strong>{roll.request.label}</strong>
        <span>
          {roll.request.notation}
          {roll.request.mode !== "normal" ? ` · ${roll.request.mode}` : ""} ·
          rolled {roll.rolls.join(", ")}
          {roll.rolls.length > roll.kept.length
            ? ` · kept ${roll.kept.join(", ")}`
            : ""}
          {roll.modifier
            ? ` · ${roll.modifier > 0 ? "+" : ""}${roll.modifier}`
            : ""}
        </span>
      </div>
      <b aria-label={`Roll total ${roll.total}`}>{roll.total}</b>
    </div>
  );
}

function RulingNotes({
  notes,
  onOpenSource,
}: {
  notes?: TurnNotes;
  onOpenSource: (source: Evidence) => void;
}) {
  if (!notes) return null;
  return (
    <>
      {notes.roll && <DiceResult roll={notes.roll} />}
      {!!notes.rulings.length && (
        <div className="dm-rulings">
          <span className="dm-small-label">
            <BookOpen size={13} /> At the rules desk
          </span>
          {notes.rulings.map((ruling, index) => (
            <div key={index} className="dm-ruling">
              <p>{ruling.text}</p>
              <div className="dm-citations">
                {ruling.citations.map((citation) => {
                  const evidence = notes.evidence.find(
                    (source) => source.citation === citation,
                  );
                  return evidence ? (
                    <button
                      key={citation}
                      onClick={() => onOpenSource(evidence)}
                      title={`Read ${evidence.title}`}
                    >
                      <span>{citation}</span>
                      {evidence.title}
                      <small>p. {evidence.page_start}</small>
                    </button>
                  ) : null;
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function safeError(status: number, connect = false) {
  if (status === 401 || status === 403)
    return "OpenAI couldn't authorize that key. Check the key and your access to GPT-5.6 Sol, then reconnect.";
  if (status === 429)
    return "The request limit was reached. Check your OpenAI API balance and limits, then try again in a moment.";
  if (status === 422 || status === 400)
    return "The request couldn't be accepted. Review the campaign sheet and try again.";
  if (status === 503)
    return "The Dungeon Master isn't ready yet. Check the server setup and the indexed rulebook, then retry.";
  return connect
    ? "The key couldn't be checked. Check your connection and try again."
    : "The Dungeon Master couldn't finish this turn. Your campaign and any rolled dice are kept. Try again.";
}

async function apiRequest(
  path: string,
  apiKey: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(
      typeof detail?.detail === "string" && detail.detail.length <= 600
        ? detail.detail
        : safeError(response.status, path.endsWith("connect")),
    );
  }
  return response.json();
}

export default function DungeonMaster({
  onOpenRules,
  onOpenSource,
}: {
  onOpenRules?: () => void;
  onOpenSource?: (source: Evidence) => void;
}) {
  const [initial] = useState(loadTable);
  const [table, setTable] = useState<SavedTable | null>(initial.table);
  const [draft, setDraft] = useState<Campaign>(starterCampaign);
  const [apiKey, setApiKey] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [error, setError] = useState(initial.error);
  const [storageError, setStorageError] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<"party" | "memory" | null>(null);
  const [editDraft, setEditDraft] = useState<Campaign | null>(null);
  const [editError, setEditError] = useState("");
  const [source, setSource] = useState<Evidence | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const keyRequestRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const importRef = useRef<HTMLInputElement | null>(null);
  const keyInputRef = useRef<HTMLInputElement | null>(null);
  const latestTurnRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const campaign = table?.campaign;

  useEffect(
    () => () => {
      requestRef.current?.abort();
      keyRequestRef.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!table) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(table));
      setStorageError("");
    } catch {
      setStorageError(
        "Your browser couldn't save this campaign. Export a copy before closing the page.",
      );
    }
  }, [table]);
  useEffect(() => {
    if (source || editing) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [source, editing]);

  async function connectKey(event: FormEvent) {
    event.preventDefault();
    if (keyRequestRef.current || !apiKey.trim()) return;
    const controller = new AbortController();
    keyRequestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    setConnecting(true);
    setKeyError("");
    try {
      const result = await apiRequest(
        "/api/dm/connect",
        apiKey.trim(),
        undefined,
        controller.signal,
      );
      if (result.model !== MODEL)
        throw new Error(
          "The server returned a different model. Check that RuleKeeper is up to date.",
        );
      setApiKey(apiKey.trim());
      setConnected(true);
      setNotice("Key connected. The table is ready when you are.");
    } catch (error) {
      setConnected(false);
      setKeyError(
        controller.signal.aborted
          ? "The key check timed out. Please try again."
          : error instanceof Error
            ? error.message
            : "The key couldn't be checked.",
      );
    } finally {
      window.clearTimeout(timeout);
      keyRequestRef.current = null;
      setConnecting(false);
    }
  }

  function prepareTable(event: FormEvent) {
    event.preventDefault();
    try {
      const prepared = parseCampaign(draft);
      setTable({
        version: 1,
        campaign: prepared,
        notes: {},
        pendingRoll: null,
      });
      setError("");
      setNotice(
        "Campaign prepared. Connect your key when you're ready to begin.",
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError(
        "Check the character sheet. Names are required; hit points, level, and armor class must be within the shown limits.",
      );
    }
  }

  async function takeTurn(submittedAction: string, shouldRoll = false) {
    if (!table || !connected || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 180_000);
    let roll = table.pendingRoll;
    try {
      if (shouldRoll && !roll) {
        if (!table.campaign.pending_roll)
          throw new Error("There is no pending roll.");
        roll = parseRollResult(
          await apiRequest(
            "/api/dm/roll",
            "",
            table.campaign.pending_roll,
            controller.signal,
          ),
        );
        const result = roll;
        setTable((current) =>
          current ? { ...current, pendingRoll: result } : current,
        );
      }
      const requestCampaign = {
        ...table.campaign,
        history: table.campaign.history.slice(-12),
      };
      const requestBody = {
        campaign: requestCampaign,
        action: submittedAction,
        roll,
      };
      while (
        new TextEncoder().encode(JSON.stringify(requestBody)).length > 95_000 &&
        requestCampaign.history.length
      )
        requestCampaign.history.shift();
      if (new TextEncoder().encode(JSON.stringify(requestBody)).length > 95_000)
        throw new Error(
          "The campaign notes are too long to send. Shorten the party notes or campaign memory, then retry.",
        );
      const result = (await apiRequest(
        "/api/dm/turn",
        apiKey,
        requestBody,
        controller.signal,
      )) as DMTurnResponse;
      const nextCampaign = parseCampaign(result.campaign);
      nextCampaign.history = [
        ...table.campaign.history,
        ...nextCampaign.history.slice(-2),
      ].slice(-200);
      if (result.model !== MODEL)
        throw new Error(
          "The response used an unexpected model. Your campaign has not changed.",
        );
      const notes = Object.fromEntries(
        Object.entries({
          ...table.notes,
          [nextCampaign.turn_count]: {
            rulings: result.rulings,
            evidence: result.evidence,
            roll: result.roll,
            usage: result.usage,
            model: result.model,
          },
        }).slice(-100),
      );
      const nextTable = parseSavedTable({
        version: 1,
        campaign: nextCampaign,
        notes,
        pendingRoll: null,
      });
      setTable(nextTable);
      setAction("");
      setNotice("The journal has been updated.");
      window.setTimeout(
        () =>
          latestTurnRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        80,
      );
    } catch (error) {
      setError(
        controller.signal.aborted
          ? "This turn took too long. Your campaign and any rolled dice are kept; you can retry."
          : error instanceof Error
            ? error.message
            : "The turn couldn't finish. Please retry.",
      );
    } finally {
      window.clearTimeout(timeout);
      requestRef.current = null;
      busyRef.current = false;
      setBusy(false);
    }
  }

  function submitAction(event: FormEvent) {
    event.preventDefault();
    if (action.trim().length) void takeTurn(action.trim());
  }

  function exportCampaign() {
    if (!table) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(table, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${
      table.campaign.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "rulekeeper"
    }.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Campaign exported. API keys are never included.");
  }

  async function importCampaign(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > MAX_FILE_BYTES)
        throw new Error(
          "This file is too large. Campaign files must be smaller than 4 MB.",
        );
      const imported = parseSavedTable(JSON.parse(await file.text()));
      if (
        table &&
        !window.confirm(
          "Replace this table with the imported campaign? Export the current campaign first if you want to keep it.",
        )
      )
        return;
      setTable(imported);
      setAction("");
      setError("");
      setNotice(`Resumed ${imported.campaign.title}.`);
    } catch (error) {
      setError(
        error instanceof Error && error.message.includes("4 MB")
          ? error.message
          : "That file isn't a valid RuleKeeper campaign. Choose an exported campaign JSON file.",
      );
    }
  }

  function newCampaign() {
    if (
      table &&
      !window.confirm(
        "Prepare a new campaign? Export this campaign first to keep a copy. This will replace the saved table in this browser.",
      )
    )
      return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* The storage warning already explains the unavailable browser store. */
    }
    setTable(null);
    setDraft(starterCampaign());
    setAction("");
    setError("");
    setNotice("");
  }

  function openEdit(kind: "party" | "memory") {
    if (!campaign) return;
    setEditError("");
    setEditDraft(structuredClone(campaign));
    setEditing(kind);
  }

  function closeDialog() {
    setEditError("");
    setSource(null);
    setEditing(null);
    setEditDraft(null);
  }

  function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!table || !editDraft) return;
    try {
      const cleanDraft = {
        ...editDraft,
        quests: editDraft.quests.map((item) => item.trim()).filter(Boolean),
        npcs: editDraft.npcs.map((item) => item.trim()).filter(Boolean),
        inventory: editDraft.inventory
          .map((item) => item.trim())
          .filter(Boolean),
      };
      setTable({ ...table, campaign: parseCampaign(cleanDraft) });
      closeDialog();
      setError("");
      setNotice("Table notes updated. The DM will use these on the next turn.");
    } catch {
      setEditError(
        "The sheet couldn't be saved. Check the character values and keep each memory list to 20 entries of 300 characters or fewer.",
      );
    }
  }

  async function openSource(evidence: Evidence) {
    try {
      const response = await fetch(
        `/api/rules/${encodeURIComponent(evidence.id)}`,
      );
      if (!response.ok) throw new Error();
      const canonical = { ...evidence, ...(await response.json()) } as Evidence;
      if (onOpenSource) onOpenSource(canonical);
      else setSource(canonical);
    } catch {
      setError(
        "This saved citation is no longer available in the rule library. Check that the server is running with the matching rulebook.",
      );
    }
  }

  function cancelRoll() {
    if (
      !table ||
      busy ||
      !window.confirm(
        "Cancel the requested roll? Use this to correct a mistaken roll request or choose another action. Any existing roll result will be discarded.",
      )
    )
      return;
    setTable({
      ...table,
      campaign: { ...table.campaign, pending_roll: null },
      pendingRoll: null,
    });
    setNotice(
      "Roll request cancelled. Describe the correction in your next action.",
    );
  }

  const entries = campaign?.history ?? [];
  let turnNumber =
    (campaign?.turn_count ?? 0) -
    entries.filter((entry) => entry.role === "dm").length;
  const totalTokens = Object.values(table?.notes ?? {}).reduce(
    (sum, notes) =>
      sum +
      (typeof notes.usage.total_tokens === "number"
        ? notes.usage.total_tokens
        : 0),
    0,
  );

  const keyPanel = (
    <section className="dm-key-panel" aria-labelledby="dm-key-heading">
      <div className="dm-rail-heading">
        <KeyRound size={16} />
        <h3 id="dm-key-heading">Connect Dungeon Master</h3>
        <span
          className={`dm-connection-dot${connected ? " dm-connected" : ""}`}
          title={connected ? "Connected" : "Not connected"}
        />
      </div>
      <p className="dm-key-description">
        GPT-5.6 Sol runs the adventure. Connect your own OpenAI API key to use
        Dungeon Master.
      </p>
      {connected ? (
        <div className="dm-connected-row">
          <span>
            <Check size={15} /> Key connected
          </span>
          <button
            type="button"
            className="dm-text-button"
            disabled={busy}
            onClick={() => {
              setApiKey("");
              setConnected(false);
              setKeyError("");
              setNotice("Key disconnected and cleared from this page.");
            }}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <form className="dm-key-form" onSubmit={connectKey}>
          <label className="dm-field">
            OpenAI API key
            <input
              ref={keyInputRef}
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setKeyError("");
              }}
              autoComplete="off"
              spellCheck={false}
              maxLength={512}
              placeholder="sk-…"
              required
              disabled={connecting}
            />
          </label>
          <button
            type="submit"
            className="dm-secondary-button"
            disabled={connecting || !apiKey.trim()}
          >
            {connecting ? (
              <LoaderCircle size={15} className="dm-spin" />
            ) : (
              <KeyRound size={15} />
            )}
            {connecting ? "Checking key…" : "Connect key"}
          </button>
        </form>
      )}
      {keyError && (
        <p className="dm-inline-error" role="alert">
          {keyError}
        </p>
      )}
      <p className="dm-key-footnote">
        The key passes through this server to OpenAI for requests. It stays in
        this page's memory and clears on reload. Your OpenAI account pays for
        API usage.
      </p>
      <details className="dm-privacy-details">
        <summary>
          What leaves this device?
          <ChevronDown size={13} />
        </summary>
        <p>
          Your campaign, recent journal, action, and relevant rulebook passages
          are sent to OpenAI. Campaigns save in this browser, without the key.
          Only connect to a RuleKeeper server you trust.
        </p>
      </details>
    </section>
  );

  return (
    <div className="dm-workspace">
      <header className="dm-masthead">
        <div className="dm-small-label">
          <Compass size={15} /> Campaign
        </div>
        <div className="dm-toolbar">
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="dm-visually-hidden"
            onChange={importCampaign}
            aria-label="Import campaign file"
          />
          <button
            className="dm-text-button"
            onClick={() => importRef.current?.click()}
            disabled={busy}
          >
            <Upload size={14} /> Import
          </button>
          {table && (
            <>
              <button
                className="dm-text-button"
                onClick={exportCampaign}
                disabled={busy}
              >
                <Download size={14} /> Export
              </button>
              <button
                className="dm-text-button"
                onClick={newCampaign}
                disabled={busy}
              >
                <Plus size={14} /> New campaign
              </button>
            </>
          )}
        </div>
      </header>
      <div className="dm-status-region" aria-live="polite" role="status">
        {notice}
      </div>
      {storageError && (
        <div className="dm-alert" role="alert">
          <CircleHelp size={18} />
          <p>{storageError}</p>
        </div>
      )}
      {error && (
        <div className="dm-alert" role="alert">
          <CircleHelp size={18} />
          <p>{error}</p>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}

      {!campaign ? (
        <>
          <section className="dm-introduction">
            <div>
              <h1>Create a campaign</h1>
              <p>
                Set the premise and add your characters. Connect an API key when
                you're ready to play.
              </p>
            </div>
          </section>
          <div className="dm-desk-grid dm-setup-grid">
            <form className="dm-setup-paper" onSubmit={prepareTable}>
              <div className="dm-paper-title">
                <div>
                  <h2>Campaign details</h2>
                  <p>Use the example below or enter your own setting.</p>
                </div>
              </div>
              <CampaignFields draft={draft} setDraft={setDraft} />
              <div className="dm-form-footer">
                <p>No key needed to prepare your campaign.</p>
                <button className="dm-primary-button" type="submit">
                  Create campaign <ArrowRight size={17} />
                </button>
              </div>
            </form>
            <aside className="dm-rail">
              {keyPanel}
              <section className="dm-starter-card">
                <div className="dm-small-label">
                  <ScrollText size={14} /> Starter campaign
                </div>
                <h3>The Bell at Blackwater</h3>
                <p>
                  Investigate a drowned chapel whose bell is changing the
                  villagers' memories.
                </p>
                <span className="dm-starter-caption">Level 1 · Mystery</span>
              </section>
              <section className="dm-table-agreement">
                <h3>Playing a turn</h3>
                <p>
                  Describe your action, make any requested roll, then read the
                  outcome. You can edit the party sheet and campaign notes at
                  any time.
                </p>
                {onOpenRules && (
                  <button className="dm-text-button" onClick={onOpenRules}>
                    <BookOpen size={15} /> Ask the rules{" "}
                    <ArrowRight size={14} />
                  </button>
                )}
              </section>
            </aside>
          </div>
        </>
      ) : (
        <>
          <section className="dm-campaign-header">
            <div className="dm-campaign-heading">
              <span className="dm-eyebrow">
                Campaign journal <span>Turn {campaign.turn_count}</span>
              </span>
              <h1>{campaign.title}</h1>
              <div className="dm-campaign-meta">
                <span>
                  <MapPin size={14} />
                  {campaign.location || "No location set"}
                </span>
                <span>{campaign.tone}</span>
              </div>
            </div>
          </section>
          <div className="dm-desk-grid dm-play-grid">
            <div className="dm-journal-column">
              {!entries.length ? (
                <section className="dm-unopened-journal">
                  <span className="dm-small-label">Campaign premise</span>
                  <h2>Opening scene</h2>
                  <p>{campaign.premise}</p>
                  <button
                    type="button"
                    className="dm-primary-button"
                    onClick={() =>
                      void takeTurn(
                        "Begin the adventure. Introduce the opening scene and invite the party to act.",
                      )
                    }
                    disabled={!connected || busy}
                  >
                    {busy ? (
                      <LoaderCircle size={17} className="dm-spin" />
                    ) : (
                      <Feather size={17} />
                    )}
                    {busy ? "Setting the scene…" : "Begin adventure"}
                  </button>
                  {!connected && (
                    <p className="dm-start-help">
                      Connect your API key in the panel to begin.
                    </p>
                  )}
                </section>
              ) : (
                <div className="dm-journal" aria-label="Campaign journal">
                  {entries.map((entry, index) => {
                    if (entry.role === "player")
                      return (
                        <div className="dm-player-entry" key={index}>
                          <span className="dm-small-label">
                            <Swords size={13} /> The party
                          </span>
                          <p>{entry.text}</p>
                        </div>
                      );
                    turnNumber += 1;
                    return (
                      <article
                        key={index}
                        className="dm-dm-entry"
                        ref={
                          index === entries.length - 1
                            ? latestTurnRef
                            : undefined
                        }
                      >
                        <div className="dm-entry-margin">
                          <span>DM</span>
                          <span>Turn {turnNumber}</span>
                        </div>
                        <div className="dm-entry-body">
                          <div className="dm-narration">
                            <PlainParagraphs text={entry.text} />
                          </div>
                          <RulingNotes
                            notes={table?.notes[turnNumber]}
                            onOpenSource={openSource}
                          />
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              {campaign.pending_roll && (
                <section
                  className="dm-roll-request"
                  aria-label="Requested dice roll"
                >
                  <div className="dm-roll-heading">
                    <DiceMark small />
                    <div>
                      <span className="dm-small-label">
                        Let the dice decide
                      </span>
                      <h3>{campaign.pending_roll.label}</h3>
                    </div>
                    <span className="dm-roll-notation">
                      {campaign.pending_roll.notation}
                    </span>
                  </div>
                  <p>{campaign.pending_roll.reason}</p>
                  {campaign.pending_roll.mode !== "normal" && (
                    <span className="dm-roll-mode">
                      With {campaign.pending_roll.mode}
                    </span>
                  )}
                  {table.pendingRoll && <DiceResult roll={table.pendingRoll} />}
                  <button
                    type="button"
                    className="dm-primary-button"
                    disabled={!connected || busy}
                    onClick={() =>
                      void takeTurn(
                        `Resolve the requested ${campaign.pending_roll?.label ?? "dice roll"}.`,
                        true,
                      )
                    }
                  >
                    {busy ? (
                      <LoaderCircle size={16} className="dm-spin" />
                    ) : table.pendingRoll ? (
                      <RotateCcw size={16} />
                    ) : (
                      <DiceMark small />
                    )}
                    {busy
                      ? "Resolving the roll…"
                      : table.pendingRoll
                        ? "Continue with this roll"
                        : "Roll and continue"}
                  </button>
                  <p className="dm-roll-footnote">
                    {table.pendingRoll
                      ? "This result is saved. Retrying uses the same roll."
                      : "The server rolls the dice. The DM narrates the outcome."}
                  </p>
                  <button
                    type="button"
                    className="dm-text-button dm-cancel-roll"
                    onClick={cancelRoll}
                    disabled={busy}
                  >
                    Cancel this roll
                  </button>
                </section>
              )}
              {!!entries.length && (
                <form className="dm-action-form" onSubmit={submitAction}>
                  <div className="dm-section-heading">
                    <label htmlFor="dm-player-action">What do you do?</label>
                  </div>
                  <textarea
                    id="dm-player-action"
                    aria-label="Your action"
                    value={action}
                    onChange={(event) => setAction(event.target.value)}
                    maxLength={2000}
                    rows={4}
                    disabled={busy || !!campaign.pending_roll}
                    placeholder={
                      campaign.pending_roll
                        ? "Resolve the requested roll to continue the scene."
                        : "For example: I check the door for traps."
                    }
                    required
                  />
                  <div className="dm-action-footer">
                    <p>
                      {!connected
                        ? "Reconnect your key to continue."
                        : campaign.pending_roll
                          ? "A dice roll is waiting above."
                          : "Enter to add a line. Use Take action to send."}
                    </p>
                    <button
                      className="dm-primary-button"
                      type="submit"
                      disabled={
                        !connected ||
                        busy ||
                        !action.trim() ||
                        !!campaign.pending_roll
                      }
                    >
                      {busy ? (
                        <LoaderCircle size={16} className="dm-spin" />
                      ) : (
                        <ArrowRight size={16} />
                      )}
                      {busy ? "Waiting for the DM…" : "Take action"}
                    </button>
                  </div>
                </form>
              )}
              {busy && (
                <p className="dm-working-note" role="status">
                  <span className="dm-ink-dot" /> Consulting the journal and
                  rulebook. This may take a moment.
                </p>
              )}
              <p className="dm-journal-footnote">
                Saved in this browser. Use Export to keep a backup.
              </p>
            </div>
            <aside className="dm-rail">
              <section className="dm-party-panel">
                <div className="dm-rail-heading">
                  <Users size={16} />
                  <h3>The party</h3>
                  <button
                    className="dm-text-button"
                    onClick={() => openEdit("party")}
                    disabled={busy}
                    aria-label="Edit party sheet"
                  >
                    <SlidersHorizontal size={14} /> Edit
                  </button>
                </div>
                {campaign.characters.map((character) => (
                  <article className="dm-party-character" key={character.id}>
                    <div className="dm-character-sigil" aria-hidden="true">
                      {character.name.charAt(0)}
                    </div>
                    <div className="dm-party-character-info">
                      <h4>{character.name}</h4>
                      <p>{characterDescription(character)}</p>
                      <div className="dm-vitals">
                        <span title="Hit points">
                          <Heart size={12} />
                          {character.hp}
                          <small>/{character.max_hp}</small>
                        </span>
                        <span title="Armor class">
                          <Shield size={12} />
                          {character.armor_class}
                          <small>AC</small>
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </section>
              {keyPanel}
              <section className="dm-memory-panel">
                <div className="dm-rail-heading">
                  <ScrollText size={16} />
                  <h3>Campaign memory</h3>
                  <button
                    className="dm-text-button"
                    onClick={() => openEdit("memory")}
                    disabled={busy}
                    aria-label="Edit campaign memory"
                  >
                    Edit
                  </button>
                </div>
                <p className="dm-memory-description">
                  The facts the DM carries into the next scene.
                </p>
                <details open>
                  <summary>
                    Story so far <ChevronDown size={14} />
                  </summary>
                  <p>
                    {campaign.summary ||
                      "The journal is still blank. Important events will collect here as you play."}
                  </p>
                </details>
                {(
                  [
                    ["Open threads", campaign.quests],
                    ["People & creatures", campaign.npcs],
                    ["Shared inventory", campaign.inventory],
                  ] as [string, string[]][]
                ).map(([label, items]) => (
                  <details key={label} open={items.length > 0}>
                    <summary>
                      {label}
                      <span>{items.length}</span>
                      <ChevronDown size={14} />
                    </summary>
                    {items.length ? (
                      <ul>
                        {items.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>Nothing recorded yet.</p>
                    )}
                  </details>
                ))}
              </section>
              <section className="dm-reference-card">
                <BookOpen size={21} />
                <div>
                  <h3>Rules reference</h3>
                  <p>
                    Mechanical rulings include source passages. Open a citation
                    to see what the rulebook says.
                  </p>
                  {onOpenRules && (
                    <button className="dm-text-button" onClick={onOpenRules}>
                      Ask the rules <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              </section>
              {!!totalTokens && (
                <p className="dm-token-note">
                  {MODEL} · {totalTokens.toLocaleString()} tokens across the
                  saved turns
                </p>
              )}
            </aside>
          </div>
        </>
      )}
      <footer className="dm-page-footer">
        <span>Campaign data is saved in this browser.</span>
        <span>SRD 5.2.1 · D&D 2024 rules</span>
      </footer>
      <dialog
        ref={dialogRef}
        className="dm-dialog"
        onCancel={closeDialog}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
        aria-labelledby="dm-dialog-title"
      >
        <div className="dm-dialog-header">
          <h2 id="dm-dialog-title">
            {source
              ? source.title
              : editing === "party"
                ? "The party sheet"
                : "What the DM remembers"}
          </h2>
          <button onClick={closeDialog} aria-label="Close campaign dialog">
            <X size={20} />
          </button>
        </div>
        {source ? (
          <div className="dm-source-content">
            <span className="dm-small-label">
              {source.category} · SRD {source.edition} · page{" "}
              {source.page_start}
              {source.page_end !== source.page_start
                ? `–${source.page_end}`
                : ""}
            </span>
            <PlainParagraphs text={source.text} />
            <a
              className="dm-text-button"
              href={`/api/source.pdf#page=${source.page_start}`}
              target="_blank"
              rel="noreferrer"
            >
              <BookOpen size={15} /> Read the rulebook page{" "}
              <ArrowRight size={14} />
            </a>
          </div>
        ) : (
          editDraft && (
            <form onSubmit={saveEdit}>
              {editError && (
                <p className="dm-inline-error" role="alert">
                  {editError}
                </p>
              )}
              <p className="dm-dialog-description">
                {editing === "party"
                  ? "Keep the sheet honest. Your changes are included in the DM's next turn."
                  : "Correct a detail or add a fact the DM should retain. These notes travel with the campaign."}
              </p>
              {editing === "party" ? (
                <CampaignFields
                  draft={editDraft}
                  setDraft={setEditDraft}
                  partyOnly
                />
              ) : (
                <>
                  <label className="dm-field">
                    Current location
                    <input
                      value={editDraft.location}
                      onChange={(event) =>
                        setEditDraft({
                          ...editDraft,
                          location: event.target.value,
                        })
                      }
                      maxLength={200}
                    />
                  </label>
                  <label className="dm-field">
                    Story so far
                    <textarea
                      value={editDraft.summary}
                      onChange={(event) =>
                        setEditDraft({
                          ...editDraft,
                          summary: event.target.value,
                        })
                      }
                      maxLength={4000}
                      rows={7}
                    />
                  </label>
                  {(
                    [
                      ["Open threads", "quests"],
                      ["People & creatures", "npcs"],
                      ["Shared inventory", "inventory"],
                    ] as const
                  ).map(([label, key]) => (
                    <label className="dm-field" key={key}>
                      {label}
                      <textarea
                        value={editDraft[key].join("\n")}
                        onChange={(event) =>
                          setEditDraft({
                            ...editDraft,
                            [key]: event.target.value.split("\n"),
                          })
                        }
                        maxLength={6000}
                        rows={4}
                      />
                      <span className="dm-field-hint">
                        One entry per line, up to 20 entries. Keep each under
                        300 characters.
                      </span>
                    </label>
                  ))}
                </>
              )}
              <div className="dm-dialog-actions">
                <button
                  type="button"
                  className="dm-text-button"
                  onClick={closeDialog}
                >
                  Cancel
                </button>
                <button type="submit" className="dm-primary-button">
                  Save {editing === "party" ? "sheet" : "memory"}
                  <Check size={16} />
                </button>
              </div>
            </form>
          )
        )}
      </dialog>
    </div>
  );
}
