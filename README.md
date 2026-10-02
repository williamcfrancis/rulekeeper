# RuleKeeper

A D&D rules reference with page citations and an optional Dungeon Master.

Ask a question, read the answer, then open the cited rule in the original PDF. The index covers the official SRD 5.2.1. Search runs locally; answers can use a local model or a hosted provider.

![RuleKeeper rules search with example questions and the SRD index](docs/screenshot-desktop.png)

[Mobile view](docs/screenshot-mobile.png) · [Campaign journal](docs/screenshot-dm-desktop.png) · [Setup](docs/setup.md) · [CI](https://github.com/williamcfrancis/rulekeeper/actions/workflows/ci.yml)

## Run it

Requires Python 3.11–3.13 and Node.js 22.12+. From a clone of this repository, on Windows:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m rulekeeper ingest
cd web
npm ci
npm run build
cd ..
.\.venv\Scripts\python.exe -m rulekeeper serve
```

Open **http://127.0.0.1:8000**. This gives you search, the compendium, and source excerpts without an API key. [Setup instructions](docs/setup.md) cover local Qwen3 answers, hosted providers, and macOS/Linux.

## Retrieval decisions

The useful test case is a rules interaction: **can a prone, grappled creature stand up?** The answer needs both definitions. Retrieving a spell that happens to remove either condition is insufficient.

- **BM25 + MiniLM, fused by rank.** Exact rule names matter, but players rarely use the rulebook's wording. Hybrid search combines the two result lists before optional cross-encoder reranking.
- **A NumPy matrix instead of a vector service.** There are 3,005 passages and 384 dimensions. The float32 vectors occupy about 4.4 MiB; exact search keeps setup small and the index reproducible.
- **Definitions survive reranking.** The cross-encoder once preferred *Power Word Heal* over the general Prone rule. Named definitions now keep their place in the six-passage context. Death and zero-HP questions have similar explicit retrieval hints.
- **Citations are assembled in code.** The model returns claims and supporting clause IDs. The backend validates those IDs and renders the references. This catches nonexistent sources; it cannot prove the model interpreted a rule correctly.

The full path, including PDF extraction and context limits, is in [architecture.md](docs/architecture.md). The code is split into [ingestion](src/rulekeeper/ingest.py), [retrieval](src/rulekeeper/retrieval.py), and [generation](src/rulekeeper/generation.py).

## What the evaluation shows

On the 30-question test set, BM25 retrieved **80.0%** of the required evidence groups. Vector search reached **98.3%**; hybrid search reached **100%**. Adding the reranker left recall unchanged and raised median retrieval time from **14.4 ms to 975.2 ms** on the recorded machine. It remains configurable because that cost is substantial.

These are authored questions that have been inspected during development, not an independent holdout or an answer-accuracy score. [Raw results](eval/results.json) include every method and retrieved passage. Six additional [regression cases](eval/questions.json) cover condition interactions, death from damage, and burning at zero HP.

The fire/death bug was a separate failure: “what happens if i die from fire?” brought back fire spells and monster attacks instead of death rules. Context preservation and a separate local reasoning budget addressed the reproduced case. [Regression notes](docs/verification.md) record both failures and the limits of the checks.

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m rulekeeper evaluate --split test
.\.venv\Scripts\python.exe -m rulekeeper evaluate --split regression
```

CI also indexes the real PDF and runs desktop/mobile browser tests. `scripts/verify_live.py` checks a small set of answers against the running local model.

## Dungeon Master

Create a campaign, add the party, and describe an action. The DM retrieves rules, uses the recent journal and editable campaign notes, and asks for a roll when needed. The backend rolls the dice; the model narrates the result. Campaigns stay in the browser and support JSON import/export.

This mode uses GPT-5.6 Sol and your OpenAI API key. The key stays in tab memory, clears on reload, and is excluded from campaign exports. [Provider setup and data handling](docs/setup.md#start-a-campaign) explain what leaves the device. The DM screenshots use sample narration; automated hosted-provider tests mock the model response. Live paid generation has not been verified.

## Scope

SRD 5.2.1 only: no other editions, book uploads, or house-rule ingestion. The DM is not a complete combat engine. Extracted tables can lose structure, and cited answers can still be wrong. This is a local app; public hosting needs authentication and rate controls. The Docker route is available but has not been runtime-tested.

Python / FastAPI / FastEmbed / NumPy on the backend. React / TypeScript / Vite in the browser.

Maintained by [William C Francis](https://github.com/williamcfrancis). Application code is [MIT licensed](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for the rulebook, models, fonts, and runtime.

This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.
