# Verification and known limits

The application was exercised against the actual 364-page SRD 5.2.1 PDF and its 3,005 extracted passages. Source files, model weights, API keys, and local logs are excluded from Git.

The original rules-reference release passed [a clean Linux CI run](https://github.com/williamcfrancis/rulekeeper/actions/runs/36279947027) with 25 Python tests and six browser tests. Linux ingestion reproduced the Windows corpus fingerprint `291840d3c390f9ce643fd6fef518bfb9e0df6e63c54b61388de9adb82258a76f`.

## Dungeon Master verification

The expanded Python suite passes **81 tests** locally, and the TypeScript/Vite production build passes. DM tests cover the actual API turn, server dice, and resolution pipeline using a mocked OpenAI transport. They also exercise structured response validation, unknown citations, roster changes, refusals, incomplete responses, key redaction, history limits, origins, host validation, request-size limits, and dice arithmetic.

The new browser journeys use authored fixtures for the paid model boundary, with real application dice and rule-library endpoints. They check campaign setup, a complete action/roll/resolution sequence, retrying the same roll after a failure and reload, key exclusion from exports/storage, canonical source lookup after importing altered evidence, and edited memory with bounded recent context. This tests the application contract, not the quality of live GPT-5.6 Sol narration.

Manual browser checks cover desktop and mobile layout, preparing a campaign without a key, memory edits surviving a reload, invalid-key feedback, and clearing the entered key on reload. No successful paid GPT-5.6 Sol generation has been run because a personal API key was not supplied.

## Local checks

- Python unit/API tests verify extraction, edition filtering, index integrity, evidence references, provider fallback, and request validation without downloading models.
- The React/TypeScript production build compiles successfully.
- The full local generation path uses Qwen3-4B Q4_K_M with the pinned llama.cpp Vulkan runtime. Four rules examples and three abstention cases are checked by `scripts/verify_live.py`; responses include original evidence and timings for inspection.
- Manual browser checks exercise the production app, citation dialogs, source links, saved passages, and responsive navigation.
- GitHub Actions runs the Python tests, builds the frontend, downloads/indexes the real corpus, and exercises browser journeys at 1440×1000 and 390×844. Its artifacts include screenshots and failure traces.

## A failure worth documenting

An early answer to “If a creature is both prone and grappled, can it stand up?” was wrong. The cross-encoder ranked **Power Word Heal** and monster actions above the general condition definitions. The small local model then applied the spell's special permission to stand as if it were a general Prone rule.

The repair has three parts: preserve glossary definitions named in composite questions; avoid unrelated spell/monster exceptions in the generation context of general condition interactions; and select explicit evidence clauses before composing an answer. The corrected local response connects Grappled's Speed 0 with Prone's prohibition on righting yourself at Speed 0. A regression test covers definition selection, and the live acceptance check requires the negative ruling and Speed 0 explanation.

These repairs do not establish that every answer is correct. Valid references can still support an invalid inference, and phrase-based acceptance checks are intentionally limited. Review the actual rules when a ruling matters. A broader independently labeled answer-quality study would be needed to quantify correctness.

## Reproduction boundaries

The committed retrieval results are measured output, including weaker methods and per-question misses. They do not measure generated-answer accuracy. The question set is authored and has been inspected during development; it is not an untouched external benchmark.

The hosted Responses API path has not been exercised with a paid account. Docker was unavailable on the development machine, so the Docker route is supplied without a local runtime verification claim. Table structure can be lost during text extraction; the original PDF remains available from every passage.
