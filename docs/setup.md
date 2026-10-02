# Running RuleKeeper

## Quick start

Requirements: **Python 3.11–3.13** and **Node.js 22.12+**. Initial setup downloads the public PDF, embedding and reranking weights, and dependencies.

```powershell
git clone https://github.com/williamcfrancis/rulekeeper.git
cd rulekeeper
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m rulekeeper ingest
cd web
npm ci
npm run build
cd ..
.\.venv\Scripts\python.exe -m rulekeeper serve
```

Open **http://127.0.0.1:8000**. On Windows, **Start RuleKeeper.cmd** can launch subsequent sessions and reuse running services.

On macOS/Linux, activate `.venv` and use `pip install -e '.[dev]'`, `rulekeeper ingest`, the same npm commands, and `rulekeeper serve`.

Search, the compendium, bookmarks, and retrieval evaluation work without an API key. Until an answer provider is configured, rules questions return labeled source excerpts. Ingestion checks the PDF against a pinned checksum; stop the server before rebuilding the index.

## Start a campaign

Open **Dungeon Master**, enter a premise and party details, then connect your OpenAI API key. The connection check verifies access to `gpt-5.6-sol`. Starting or continuing an adventure makes a paid request on your OpenAI account.

The key stays in the tab's memory and clears on reload or disconnect. It passes through the local backend for OpenAI requests but is excluded from browser storage and campaign exports. Campaigns themselves are saved in localStorage; use export to keep a backup.

Each turn sends the current action, campaign memory, recent journal entries, and retrieved rules to OpenAI. The app uses `store: false`; provider retention policies still apply. See [data handling](architecture.md#application-and-privacy).

## Local rules answers

The Windows setup script installs a pinned llama.cpp runtime and **Qwen3-4B Q4_K_M** in `.local/`. The model download is about 2.5 GB. Vulkan needs a compatible GPU and driver; `--backend cpu` is also available.

```powershell
.\.venv\Scripts\python.exe scripts\setup_local_model.py --backend vulkan
Copy-Item .env.example .env
```

Set these values in `.env` and restart RuleKeeper:

```dotenv
RULEKEEPER_PROVIDER=local
RULEKEEPER_LOCAL_BASE_URL=http://127.0.0.1:8081/v1
RULEKEEPER_LOCAL_MODEL=qwen3-4b
```

The Windows launcher starts the installed model server. For a separately installed llama.cpp server on another OS:

```bash
llama-server -hf Qwen/Qwen3-4B-GGUF:Q4_K_M --host 127.0.0.1 --port 8081 --alias qwen3-4b -c 6144 --jinja
```

Keep port 8081 free for that server. Other compatible servers may need different model settings. The bundled runtime is the tested local integration.

## Hosted rules answers

Set `RULEKEEPER_PROVIDER=openai`, `OPENAI_API_KEY`, and `RULEKEEPER_OPENAI_MODEL` in the server environment or `.env`. This provider uses the Responses API and incurs usage charges. Its server-side key is separate from the key entered for Dungeon Master mode.

A timeout or invalid answer produces an explicit error and the retrieved source excerpts. A failed Dungeon Master turn leaves the campaign available for retry. Hosted-provider tests use mocked responses; live paid generation has not been verified.

## Development

Run `rulekeeper serve` from the project root and `npm run dev` inside `web/`. Vite proxies `/api` to port 8000. The production server serves the compiled frontend; API documentation is at `/docs`.

To run the browser tests, build the frontend, put the project's Python environment on `PATH`, then run `npx playwright install chromium` and `npm run test:e2e` inside `web/`. Playwright starts a separate source-excerpt server on port 8010 so tests do not use the running app's answer provider.

```text
src/rulekeeper/       ingestion, retrieval, generation, DM turns, API, evaluation
web/                 React application and browser tests
tests/               Python unit and API tests
eval/                labeled questions and measured results
scripts/             model setup, launcher, and local checks
docs/                architecture, test notes, and screenshots
data/                downloaded PDF and generated index (Git-ignored)
.local/              model runtime and local logs (Git-ignored)
```

`compose.yaml` provides an alternative deployment with persistent index storage and a loopback-bound port. The Docker route has not been runtime-tested. For a private hostname, set `RULEKEEPER_ALLOWED_HOSTS` as shown in `.env.example`; the browser and API must share an origin.
