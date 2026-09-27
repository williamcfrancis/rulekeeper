import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Compass,
  Copy,
  ExternalLink,
  FlaskConical,
  Layers3,
  LoaderCircle,
  Menu,
  Search,
  ShieldCheck,
  Sparkles,
  Swords,
  WandSparkles,
  X,
} from "lucide-react";
import DungeonMaster from "./DungeonMaster";

type Page = "dm" | "ask" | "library" | "saved" | "engine";
type Rule = {
  id: string;
  title: string;
  category: string;
  text: string;
  page_start: number;
  page_end: number;
  source_url: string;
  edition: string;
};
type Evidence = Rule & {
  citation: number;
  score: number;
  lexical_score: number;
  dense_score: number;
  rerank_score: number | null;
};
type Result = {
  question: string;
  answer: string;
  status: string;
  provider: string;
  note: string;
  evidence: Evidence[];
  cited_ids: number[];
  trace: {
    mode: string;
    retrieval_ms: number;
    generation_ms: number;
    total_ms: number;
    candidate_count: number;
    reranked_count: number;
    usage?: Record<string, number>;
  };
};
type Library = {
  chunk_count: number;
  page_count: number;
  edition: string;
  categories: string[];
  provider: string;
  semantic_ready: boolean;
  rerank_enabled: boolean;
  source_sha256: string;
};
type Recent = { question: string; category: string };
type Evaluation = {
  available?: boolean;
  split?: string;
  questions?: number;
  built_at?: string;
  results?: Record<
    string,
    { recall_at_6: number; mrr: number; p50_ms: number }
  >;
};

const examples = [
  {
    icon: WandSparkles,
    tag: "SPELLS & CONDITIONS",
    title: "Does being incapacitated break concentration?",
    question: "Does becoming incapacitated end my concentration on a spell?",
  },
  {
    icon: Swords,
    tag: "COMBAT & REACTIONS",
    title: "Can I move away without an opportunity attack?",
    question: "How does the Disengage action affect opportunity attacks?",
  },
  {
    icon: Compass,
    tag: "THE FINER DETAILS",
    title: "What if I have advantage and disadvantage?",
    question:
      "What happens if I have both advantage and disadvantage on the same roll?",
  },
];

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : "Something went wrong. Please try again.",
    );
  }
  return response.json();
}

function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function Die({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 112"
      fill="none"
      aria-hidden="true"
    >
      <path d="M50 3 96 29v53l-46 27L4 82V29L50 3Z" />
      <path d="m50 3-27 66h54L50 3ZM4 29l73 40 19-40M4 82l19-13 27 40 27-40 19 13M4 29l19 40L96 29" />
      <path d="M50 3v106M4 82l46-79 46 79" className="die-fine" />
    </svg>
  );
}

function RichText({
  text,
  evidence,
  onSource,
}: {
  text: string;
  evidence: Evidence[];
  onSource: (rule: Rule) => void;
}) {
  function inline(value: string): ReactNode[] {
    return value.split(/(\[\d+\]|\*\*.*?\*\*)/g).map((part, index) => {
      if (/^\[\d+\]$/.test(part)) {
        const source = evidence.find(
          (e) => e.citation === Number(part.slice(1, -1)),
        );
        return source ? (
          <button
            key={index}
            className="citation"
            aria-label={`Open source ${source.citation}: ${source.title}`}
            onClick={() => onSource(source)}
          >
            {source.citation}
          </button>
        ) : (
          part
        );
      }
      return part.startsWith("**") ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : (
        part
      );
    });
  }
  return (
    <div className="rich-text">
      {text
        .split(/\n\s*\n/)
        .map((paragraph, i) =>
          paragraph.startsWith("> ") ? (
            <blockquote key={i}>{inline(paragraph.slice(2))}</blockquote>
          ) : (
            <p key={i}>{inline(paragraph)}</p>
          ),
        )}
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("dm");
  const [library, setLibrary] = useState<Library | null>(null);
  const [question, setQuestion] = useState("");
  const [category, setCategory] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<Recent[]>(() =>
    stored("rulekeeper-recent", []),
  );
  const [saved, setSaved] = useState<Rule[]>(() =>
    stored("rulekeeper-saved", []),
  );
  const [source, setSource] = useState<Rule | null>(null);
  const [about, setAbout] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [ruleQuery, setRuleQuery] = useState("");
  const [ruleCategory, setRuleCategory] = useState("");
  const [offset, setOffset] = useState(0);
  const [rules, setRules] = useState<{ total: number; items: Rule[] }>({
    total: 0,
    items: [],
  });
  const [rulesBusy, setRulesBusy] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const queryRef = useRef<HTMLTextAreaElement>(null);
  const answerRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    api<Library>("/api/library")
      .then(setLibrary)
      .catch((e) => setError(e.message));
    api<Evaluation>("/api/evaluation")
      .then(setEvaluation)
      .catch(() => {});
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("rulekeeper-recent", JSON.stringify(recent));
    } catch {
      /* private browsing */
    }
  }, [recent]);
  useEffect(() => {
    try {
      localStorage.setItem("rulekeeper-saved", JSON.stringify(saved));
    } catch {
      /* storage full */
    }
  }, [saved]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if ((source || about) && dialog && !dialog.open) dialog.showModal();
    else if (dialog?.open) dialog.close();
  }, [source, about]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setPage("ask");
        setTimeout(() => queryRef.current?.focus(), 0);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (page !== "library") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setRulesBusy(true);
      api<{ total: number; items: Rule[] }>(
        `/api/rules?${new URLSearchParams({ q: ruleQuery, category: ruleCategory, offset: String(offset) })}`,
        { signal: controller.signal },
      )
        .then(setRules)
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setRulesBusy(false);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [page, ruleQuery, ruleCategory, offset]);
  useEffect(() => () => controllerRef.current?.abort(), []);

  function navigate(next: Page) {
    setPage(next);
    setMobileMenu(false);
    setError("");
  }
  function toggleSave(rule: Rule) {
    setSaved((list) =>
      list.some((r) => r.id === rule.id)
        ? list.filter((r) => r.id !== rule.id)
        : [...list, rule],
    );
  }
  function closeDialog() {
    setSource(null);
    setAbout(false);
  }
  async function ask(value = question, scope = category) {
    const trimmed = value.trim();
    if (trimmed.length < 3 || busy) return;
    setQuestion(trimmed);
    setPage("ask");
    setError("");
    setBusy(true);
    setResult(null);
    setTraceOpen(false);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const answer = await api<Result>("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          question: trimmed,
          category: scope || null,
          mode: "hybrid",
          edition: "5.2.1",
        }),
      });
      setResult(answer);
      setRecent((list) =>
        [
          { question: trimmed, category: scope },
          ...list.filter((r) => r.question !== trimmed),
        ].slice(0, 8),
      );
      setTimeout(
        () =>
          answerRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        100,
      );
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") setError(e.message);
    } finally {
      if (controllerRef.current === controller) {
        setBusy(false);
        controllerRef.current = null;
      }
    }
  }
  function cancel() {
    controllerRef.current?.abort();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void ask();
  }
  async function copyAnswer() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(
        `${result.question}\n\n${result.answer}\n\n${result.evidence
          .filter((e) => result.cited_ids.includes(e.citation))
          .map(
            (e) =>
              `[${e.citation}] ${e.title}, SRD 5.2.1 p. ${e.page_start}: ${e.source_url}`,
          )
          .join("\n")}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(
        "Clipboard access is unavailable. You can select and copy the answer text.",
      );
    }
  }

  const nav = [
    { page: "dm" as Page, icon: Compass, label: "Dungeon Master" },
    { page: "ask" as Page, icon: Sparkles, label: "Ask the rules" },
    { page: "library" as Page, icon: BookOpen, label: "Compendium" },
    { page: "saved" as Page, icon: Bookmark, label: "Saved passages" },
    { page: "engine" as Page, icon: FlaskConical, label: "Under the hood" },
  ];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "is-open" : ""}`}>
        <button
          className="brand"
          onClick={() => navigate("dm")}
          aria-label="RuleKeeper home"
        >
          <span className="brand-mark">
            <Die />
          </span>
          <span>
            RuleKeeper<span className="brand-sub">YOUR D&D TABLE</span>
          </span>
        </button>
        <div className="sidebar-section">AT THE TABLE</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.page}
              className={`nav-item ${page === item.page ? "active" : ""}`}
              onClick={() => navigate(item.page)}
            >
              <item.icon size={18} />
              {item.label}
              {item.page === "saved" && saved.length > 0 && (
                <span className="nav-count">{saved.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="recent">
          <div className="sidebar-section">
            RECENT QUESTIONS <Clock3 size={12} />
          </div>
          {recent.length ? (
            recent.slice(0, 5).map((item, i) => (
              <button
                key={i}
                disabled={busy}
                onClick={() => {
                  setCategory(item.category);
                  void ask(item.question, item.category);
                  setMobileMenu(false);
                }}
              >
                {item.question}
              </button>
            ))
          ) : (
            <p>
              Rules you look up will appear here for the next time you need
              them.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="library-status">
            <span className={`status-dot ${library ? "" : "offline"}`} />
            <span>
              {library ? "Library ready" : "Connecting to library"}
              <small>
                SRD 5.2.1 ·{" "}
                {library ? `${library.page_count} pages` : "Official reference"}
              </small>
            </span>
          </div>
          <button className="about-button" onClick={() => setAbout(true)}>
            <CircleHelp size={16} /> About & attribution{" "}
            <ArrowUpRight size={14} />
          </button>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-toggle icon-button"
            aria-label="Toggle navigation"
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            <Menu size={20} />
          </button>
          <span className="breadcrumb">
            RULEKEEPER <span>/</span> {nav.find((n) => n.page === page)?.label}
          </span>
          <button className="edition-pill" onClick={() => setAbout(true)}>
            <span className="status-dot" /> SRD 5.2.1 <ChevronDown size={13} />
          </button>
        </header>
        <main>
          {error && (
            <div className="error-banner" role="alert">
              <CircleHelp size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}

          <div hidden={page !== "dm"}>
            <DungeonMaster
              onOpenRules={() => navigate("ask")}
              onOpenSource={setSource}
            />
          </div>

          {page === "ask" && (
            <>
              <div className="ask-layout">
                <div className="ask-main">
                  <section className="hero">
                    <div className="eyebrow">
                      <span /> A LITTLE CLARITY. A LOT MORE ADVENTURE.
                    </div>
                    <h1>
                      Less page-turning.
                      <br />
                      <em>More adventuring.</em>
                    </h1>
                    <p>
                      Untangle a tricky rule. Settle a friendly debate.
                      <br className="desktop-break" /> Get back to the story,
                      with the source to back you up.
                    </p>
                  </section>
                  <form className="question-box" onSubmit={submit}>
                    <label className="sr-only" htmlFor="question">
                      Your rules question
                    </label>
                    <textarea
                      ref={queryRef}
                      id="question"
                      value={question}
                      maxLength={1500}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="What’s happening at your table?"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void ask();
                        }
                      }}
                    />
                    <div className="question-tools">
                      <label className="category-select">
                        <BookOpen size={15} />
                        <span className="sr-only">Search category</span>
                        <select
                          aria-label="Search category"
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                        >
                          <option value="">All rules</option>
                          {library?.categories.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                        <ChevronDown size={13} />
                      </label>
                      {busy ? (
                        <button
                          className="submit-button secondary"
                          type="button"
                          onClick={cancel}
                        >
                          Cancel <X size={16} />
                        </button>
                      ) : (
                        <button
                          className="submit-button"
                          disabled={question.trim().length < 3 || !library}
                          type="submit"
                        >
                          Find a ruling <ArrowRight size={17} />
                        </button>
                      )}
                    </div>
                  </form>
                  <div className="search-footnote">
                    <span>
                      <ShieldCheck size={14} /> Grounded in the official SRD
                    </span>
                    <span className="shortcut">
                      Enter to ask <kbd>↵</kbd>
                    </span>
                  </div>
                  {!result && !busy && (
                    <section className="starters">
                      <div className="section-kicker">
                        EVERY ADVENTURE HAS A QUESTION
                      </div>
                      {examples.map((item) => (
                        <button
                          className="starter"
                          key={item.tag}
                          onClick={() => {
                            setCategory("");
                            void ask(item.question, "");
                          }}
                          disabled={!library}
                        >
                          <span className="starter-icon">
                            <item.icon size={20} strokeWidth={1.5} />
                          </span>
                          <span>
                            <small>{item.tag}</small>
                            <strong>{item.title}</strong>
                          </span>
                          <ArrowUpRight size={17} />
                        </button>
                      ))}
                    </section>
                  )}
                </div>
                <aside className="source-rail">
                  <div className="book-cover">
                    <div className="book-topline">
                      THE OPEN RULES COLLECTION
                    </div>
                    <div className="book-title">
                      A world of rules.
                      <br />
                      <em>One trusted source.</em>
                    </div>
                    <div className="book-art">
                      <span className="orbit orbit-one" />
                      <span className="orbit orbit-two" />
                      <Die className="cover-die" />
                      <span className="art-star star-one">✦</span>
                      <span className="art-star star-two">✧</span>
                    </div>
                    <div className="book-bottom">
                      <span>
                        SYSTEM REFERENCE
                        <br />
                        DOCUMENT
                      </span>
                      <span>5.2.1</span>
                    </div>
                  </div>
                  <div className="source-caption">
                    <BookOpen size={17} />
                    <p>
                      Every answer starts with the text.
                      <br />
                      <button
                        onClick={() => {
                          setRuleCategory("");
                          navigate("library");
                        }}
                      >
                        Explore the compendium <ArrowRight size={13} />
                      </button>
                    </p>
                  </div>
                  <div className="rail-note">
                    <span>FOR PLAYERS & GAME MASTERS</span>
                    <p>
                      The final call belongs to your table. We make the rules
                      easier to find.
                    </p>
                  </div>
                </aside>
              </div>

              {busy && (
                <section className="loading-state" role="status">
                  <LoaderCircle className="spin" size={24} />
                  <div>
                    <strong>Consulting the compendium…</strong>
                    <p>
                      Finding the relevant passages and checking how they fit
                      together.
                    </p>
                  </div>
                </section>
              )}
              {result && (
                <section className="answer-section" ref={answerRef}>
                  <div className="answer-heading">
                    <span className="section-kicker">
                      {result.status === "answered"
                        ? "YOUR RULING"
                        : result.status === "sources_only"
                          ? "FROM THE SOURCE"
                          : "A LITTLE MORE CONTEXT NEEDED"}
                    </span>
                    <button
                      className="text-button"
                      onClick={() => void copyAnswer()}
                    >
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                      {copied ? "Copied" : "Copy with sources"}
                    </button>
                  </div>
                  <h2>{result.question}</h2>
                  <div className="answer-grid">
                    <div className="answer-content">
                      <div
                        className={`answer-status ${result.status === "insufficient_evidence" ? "uncertain" : ""}`}
                      >
                        <ShieldCheck size={15} />
                        {result.status === "answered"
                          ? "Answer with source citations"
                          : result.status === "sources_only"
                            ? "Original source excerpts"
                            : "Insufficient evidence"}
                        <span>SRD 5.2.1</span>
                      </div>
                      <RichText
                        text={result.answer}
                        evidence={result.evidence}
                        onSource={setSource}
                      />
                      <p className="answer-note">{result.note}</p>
                    </div>
                    <div className="evidence-list">
                      <div className="section-kicker">
                        ON THE PAGE{" "}
                        <span>{result.evidence.length} PASSAGES</span>
                      </div>
                      {result.evidence.map((item) => (
                        <button
                          className={`evidence-card ${result.cited_ids.includes(item.citation) ? "cited" : ""}`}
                          key={item.id}
                          onClick={() => setSource(item)}
                        >
                          <span className="evidence-number">
                            {item.citation}
                          </span>
                          <span>
                            <strong>{item.title}</strong>
                            <small>
                              {item.category} · p. {item.page_start}
                              {item.page_end !== item.page_start
                                ? `–${item.page_end}`
                                : ""}
                            </small>
                          </span>
                          <ArrowUpRight size={15} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="trace-block">
                    <button
                      className="trace-toggle"
                      aria-expanded={traceOpen}
                      onClick={() => setTraceOpen(!traceOpen)}
                    >
                      <Code2 size={15} /> Show retrieval trace{" "}
                      <ChevronDown
                        className={traceOpen ? "rotate" : ""}
                        size={15}
                      />
                      <span>
                        {(result.trace.total_ms / 1000).toFixed(2)}s ·{" "}
                        {result.provider === "evidence"
                          ? "Source excerpts"
                          : result.provider === "none"
                            ? "No generation"
                            : `${result.provider} model`}
                      </span>
                    </button>
                    {traceOpen && (
                      <div className="trace-details">
                        <div>
                          <small>RETRIEVAL</small>
                          <strong>{result.trace.mode || "Scope check"}</strong>
                        </div>
                        <div>
                          <small>CANDIDATES</small>
                          <strong>{result.trace.candidate_count || 0}</strong>
                        </div>
                        <div>
                          <small>RERANKED</small>
                          <strong>{result.trace.reranked_count || 0}</strong>
                        </div>
                        <div>
                          <small>SEARCH TIME</small>
                          <strong>
                            {Math.round(result.trace.retrieval_ms || 0)} ms
                          </strong>
                        </div>
                        <div>
                          <small>GENERATION</small>
                          <strong>
                            {Math.round(result.trace.generation_ms || 0)} ms
                          </strong>
                        </div>
                        <p>
                          Scores rank relevance; they are not confidence
                          percentages. Citation checks verify source references,
                          not whether every claim follows from the text.
                        </p>
                      </div>
                    )}
                  </div>
                </section>
              )}
              <div className="bottom-principles">
                <span>
                  <BookOpen size={16} /> Open rules, openly cited
                </span>
                <span>
                  <Layers3 size={16} /> One edition. No crossed wires.
                </span>
                <span>
                  <ShieldCheck size={16} /> Evidence before inference
                </span>
              </div>
            </>
          )}

          {(page === "library" || page === "saved") && (
            <section className="compendium">
              <div className="eyebrow">
                <span />{" "}
                {page === "saved"
                  ? "YOUR PERSONAL REFERENCE"
                  : "STRAIGHT FROM THE SOURCE"}
              </div>
              <h1>
                {page === "saved" ? "Keep the good pages." : "The compendium."}
              </h1>
              <p className="page-description">
                {page === "saved"
                  ? "Passages you have bookmarked, stored in this browser."
                  : "Browse the indexed passages of SRD 5.2.1. Open a rule to read its text and original page."}
              </p>
              {page === "library" && (
                <div className="library-filters">
                  <label className="library-search">
                    <Search size={18} />
                    <input
                      aria-label="Find a rule by name"
                      placeholder="Find a rule by name…"
                      value={ruleQuery}
                      onChange={(e) => {
                        setRuleQuery(e.target.value);
                        setOffset(0);
                      }}
                    />
                  </label>
                  <select
                    aria-label="Filter compendium category"
                    value={ruleCategory}
                    onChange={(e) => {
                      setRuleCategory(e.target.value);
                      setOffset(0);
                    }}
                  >
                    <option value="">All categories</option>
                    {library?.categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="library-result-count">
                {rulesBusy && page === "library"
                  ? "Searching…"
                  : `${page === "saved" ? saved.length : rules.total.toLocaleString()} passages`}
              </div>
              <div className="rules-grid">
                {(page === "saved" ? saved : rules.items).map((rule) => (
                  <article className="rule-card" key={rule.id}>
                    <div>
                      <span>{rule.category}</span>
                      <button
                        className={`icon-button ${saved.some((s) => s.id === rule.id) ? "is-saved" : ""}`}
                        aria-label={`${saved.some((s) => s.id === rule.id) ? "Unsave" : "Save"} ${rule.title}`}
                        onClick={() => toggleSave(rule)}
                      >
                        <Bookmark
                          size={17}
                          fill={
                            saved.some((s) => s.id === rule.id)
                              ? "currentColor"
                              : "none"
                          }
                        />
                      </button>
                    </div>
                    <button
                      className="rule-open"
                      onClick={() => setSource(rule)}
                    >
                      <h3>{rule.title}</h3>
                      <p>{rule.text}</p>
                      <span>
                        SRD 5.2.1 · p. {rule.page_start}{" "}
                        <ArrowUpRight size={16} />
                      </span>
                    </button>
                  </article>
                ))}
              </div>
              {(page === "saved"
                ? saved.length === 0
                : !rulesBusy && rules.total === 0) && (
                <div className="empty-state">
                  <BookOpen size={34} strokeWidth={1} />
                  <h2>
                    {page === "saved"
                      ? "Your reference shelf is waiting."
                      : "No matching rule titles."}
                  </h2>
                  <p>
                    {page === "saved"
                      ? "Open a passage and tap the bookmark to keep it close."
                      : "Try a shorter name, another category, or ask a question to search the full text."}
                  </p>
                  <button
                    className="text-button"
                    onClick={() =>
                      navigate(page === "saved" ? "library" : "ask")
                    }
                  >
                    {page === "saved"
                      ? "Browse the compendium"
                      : "Ask the rules"}{" "}
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
              {page === "library" && rules.total > 24 && (
                <div className="pagination">
                  <button
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - 24))}
                  >
                    <ChevronLeft size={16} /> Previous
                  </button>
                  <span>
                    {offset + 1}–{Math.min(offset + 24, rules.total)} of{" "}
                    {rules.total.toLocaleString()}
                  </span>
                  <button
                    disabled={offset + 24 >= rules.total}
                    onClick={() => setOffset(offset + 24)}
                  >
                    Next <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </section>
          )}

          {page === "engine" && (
            <section className="engine-page">
              <div className="eyebrow">
                <span /> BUILT TO BE INSPECTED
              </div>
              <h1>Good answers leave a trail.</h1>
              <p className="page-description">
                A small, transparent RAG system. Follow the evidence from the
                official document to the answer at your table.
              </p>
              <div className="pipeline">
                {[
                  {
                    n: "01",
                    title: "Read the right text",
                    text: "Verify the source checksum. Extract two columns separately. Split on rule headings and retain page numbers.",
                  },
                  {
                    n: "02",
                    title: "Search two ways",
                    text: "BM25 finds exact rule terms. MiniLM embeddings find related meanings. Reciprocal rank fusion joins both lists.",
                  },
                  {
                    n: "03",
                    title: "Read the shortlist",
                    text: "A cross-encoder reranks up to 24 candidates. Six passages become the bounded answer context.",
                  },
                  {
                    n: "04",
                    title: "Answer with evidence",
                    text: "A local or hosted model composes a cited explanation. Invalid references fall back to original excerpts.",
                  },
                ].map((step) => (
                  <div className="pipeline-step" key={step.n}>
                    <span>{step.n}</span>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.text}</p>
                    </div>
                    <ArrowDown size={18} />
                  </div>
                ))}
              </div>
              <div className="engine-stats">
                <div>
                  <small>INDEXED PASSAGES</small>
                  <strong>
                    {library?.chunk_count.toLocaleString() || "—"}
                  </strong>
                </div>
                <div>
                  <small>SOURCE PAGES</small>
                  <strong>{library?.page_count || "—"}</strong>
                </div>
                <div>
                  <small>EMBEDDING DIMENSIONS</small>
                  <strong>384</strong>
                </div>
                <div>
                  <small>EDITION</small>
                  <strong>5.2.1</strong>
                </div>
              </div>
              <div className="benchmark">
                <div className="section-kicker">RETRIEVAL BENCHMARK</div>
                <h2>Measure it. Then improve it.</h2>
                {evaluation?.results ? (
                  <>
                    <p>
                      {evaluation.questions} labeled questions ·{" "}
                      {evaluation.split} split. Recall measures how many
                      required evidence groups appear in the top six passages.
                    </p>
                    <div className="benchmark-grid">
                      {Object.entries(evaluation.results).map(
                        ([name, metric]) => (
                          <div key={name}>
                            <h3>{name.replaceAll("_", " ")}</h3>
                            <strong>
                              {(metric.recall_at_6 * 100).toFixed(1)}
                              <small>%</small>
                            </strong>
                            <span>Evidence recall @ 6</span>
                            <p>
                              MRR {metric.mrr.toFixed(3)} · median{" "}
                              {Math.round(metric.p50_ms)} ms
                            </p>
                          </div>
                        ),
                      )}
                    </div>
                    <p className="muted">
                      This is a small, authored benchmark, not a claim of
                      general rules accuracy. Retrieval scores do not measure
                      answer correctness.
                    </p>
                  </>
                ) : (
                  <p>
                    No benchmark results have been recorded yet. Run the
                    evaluation command to publish measured results here.
                  </p>
                )}
              </div>
              <a
                className="repo-link"
                href="https://github.com/williamcfrancis/rulekeeper"
                target="_blank"
                rel="noreferrer"
              >
                <Code2 size={18} />
                <span>Read the code, reproduce the results.</span>
                <ArrowUpRight size={18} />
              </a>
            </section>
          )}

          <footer>
            <span>
              RuleKeeper <span className="footer-dot">·</span> Adventures &
              their rules.
            </span>
            <button onClick={() => setAbout(true)}>
              Source & attribution <ExternalLink size={12} />
            </button>
          </footer>
        </main>
      </div>

      <dialog
        ref={dialogRef}
        className="source-dialog"
        onCancel={closeDialog}
        onClick={(e) => {
          if (e.target === dialogRef.current) closeDialog();
        }}
      >
        <div className="dialog-inner">
          <div className="dialog-top">
            <span className="section-kicker">
              {source ? "THE ORIGINAL PASSAGE" : "ABOUT THE LIBRARY"}
            </span>
            <button
              className="icon-button"
              aria-label="Close source"
              onClick={closeDialog}
            >
              <X size={20} />
            </button>
          </div>
          {source ? (
            <>
              <div className="source-meta">
                {source.category} <span>SRD {source.edition}</span>
              </div>
              <h2>{source.title}</h2>
              <p className="source-page">
                Page {source.page_start}
                {source.page_end !== source.page_start
                  ? `–${source.page_end}`
                  : ""}{" "}
                · Extracted from the official PDF
              </p>
              <div className="original-text">{source.text}</div>
              <div className="dialog-actions">
                <button
                  className={`outline-button ${saved.some((s) => s.id === source.id) ? "is-saved" : ""}`}
                  onClick={() => toggleSave(source)}
                >
                  <Bookmark
                    size={16}
                    fill={
                      saved.some((s) => s.id === source.id)
                        ? "currentColor"
                        : "none"
                    }
                  />
                  {saved.some((s) => s.id === source.id)
                    ? "Saved passage"
                    : "Save passage"}
                </button>
                <a
                  className="submit-button"
                  href={`/api/source.pdf#page=${source.page_start}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open original page <ExternalLink size={15} />
                </a>
              </div>
              <p className="source-caveat">
                This is one retrieved passage, not necessarily the whole rule.
                Open the original page for surrounding text and tables.
              </p>
            </>
          ) : (
            <>
              <div className="about-brand">
                <Die />
                <h2>A seat at the table.</h2>
              </div>
              <p>
                RuleKeeper runs D&D adventures with GPT-5.6 Sol and helps
                players find evidence for a ruling. This library contains SRD
                5.2.1 only; it does not include every published D&D option or
                other editions.
              </p>
              <p>
                Source links let you check mechanical rulings. The DM narrates
                scenes and tracks campaign notes; you can edit the party and
                memory when a correction is needed. Rules search still works
                without a DM key.
              </p>
              <div className="attribution">
                <h3>Attribution</h3>
                <p>
                  This work includes material from the System Reference Document
                  5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at{" "}
                  <a
                    href="https://www.dndbeyond.com/srd"
                    target="_blank"
                    rel="noreferrer"
                  >
                    dndbeyond.com/srd
                  </a>
                  . The SRD 5.2.1 is licensed under the Creative Commons
                  Attribution 4.0 International License, available at{" "}
                  <a
                    href="https://creativecommons.org/licenses/by/4.0/legalcode"
                    target="_blank"
                    rel="noreferrer"
                  >
                    creativecommons.org/licenses/by/4.0/legalcode
                  </a>
                  .
                </p>
                <p>
                  Text is extracted, normalized, and divided into passages.
                  Generated explanations are adaptations. RuleKeeper is an
                  independent project.
                </p>
              </div>
              <p className="muted">
                Campaigns, bookmarks, and recent questions stay in this browser.
                Dungeon Master sends your action, campaign context, and
                retrieved rules through this server to OpenAI. Its key stays in
                memory for this tab. Rules questions use the separately
                configured answer provider.
              </p>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
