# Testing and regression cases

Tests cover the API, retrieval pipeline, provider failures, and browser workflows. The full index contains 3,005 passages from the 364-page SRD 5.2.1 PDF.

## CI baseline

The [September 28, 2026 run](https://github.com/williamcfrancis/rulekeeper/actions/runs/36365933287) passed **103 Python tests and 16 browser tests**. GitHub Actions runs the Python suite, builds the frontend, indexes the SRD, and runs Playwright at 1440×1000 and 390×844. Browser artifacts include screenshots and failure traces.

Windows and Linux ingestion produced the same corpus fingerprint:

```text
291840d3c390f9ce643fd6fef518bfb9e0df6e63c54b61388de9adb82258a76f
```

The committed screenshots come from the [interface test run](https://github.com/williamcfrancis/rulekeeper/actions/runs/36365380332). Campaign screenshots use sample narration and a simulated key connection.

## Coverage

- **Ingestion:** column order, mixed-font baselines, edition metadata, page provenance, and corpus integrity.
- **Retrieval:** filters, glossary preservation, core death rules, citation lookup, and unrelated spell/monster distractors.
- **Generation:** structured claims, source and clause references, output limits, timeouts, and safe provider errors.
- **Campaigns:** turn validation, server dice, retrying the same roll, roster changes, editable memory, and bounded recent history.
- **Key handling:** credentials excluded from exports and browser storage, cleared on reload, and redacted from errors.
- **HTTP boundaries:** origin and host checks, body-size limits, and concurrent-request limits.
- **Browser workflows:** campaign setup, action/roll/resolution, import/export, source dialogs, bookmarks, and mobile navigation.

Dungeon Master tests mock the OpenAI response while using real application routes, dice, and rule lookup. They check application behavior, not live model narration. Paid generation has not been verified for either hosted provider path.

## Local generation

`scripts/verify_live.py` runs six answer examples and three abstention cases against Qwen3-4B Q4_K_M on the pinned llama.cpp Vulkan runtime. It saves the complete answers, retrieved evidence, and timings under `.local/` for review. The checks combine citation validation with expected phrases; they are smoke tests, not an answer-quality score.

The September 28 run passed all nine cases. Generated answers took **6.8–14.6 seconds** on the development machine. The question “what happens if i die from fire?” took **14.6 seconds** in that run and **11.8 seconds** in a separate browser check. The browser timing included 1.2 seconds of retrieval and 10.5 seconds of generation, rounded. Latency depends on hardware, context, and model settings.

## Death from fire

The original failure retrieved Burning, a fire elemental's attack, and Delayed Blast Fireball ahead of general death rules. The model could then give an incorrect interpretation with valid citation IDs. One reproduction took 53.4 seconds; another exhausted the old 2,000-token output limit before completing its answer.

The regression fixes cover three stages:

1. Preserve death, damage-type, and zero-HP headings during hybrid retrieval.
2. Exclude unrelated spell and monster exceptions from the context for a general rules question.
3. Require supporting clause references and reserve output space for the final answer with a separate reasoning budget.

Disabling reasoning was also tested. It reduced latency but introduced interpretation errors, so the local configuration retains bounded reasoning.

The six retrieval regressions cover fire and cold damage, continued burning at zero HP, prone/grappled interaction, and the distinction between a damage die and dying. Reranked hybrid search retrieved all labeled evidence groups in these cases and the 30-question test set. These results measure retrieval against the authored labels.

Browser tests check the fire/death source passages and original-page links. A simulated timeout checks the elapsed timer and explicit source-only fallback message.

## Prone and grappled

A cross-encoder previously ranked Power Word Heal and monster actions above the general condition definitions. The answer model treated the spell's permission to stand as a general Prone rule.

Hybrid retrieval now preserves named glossary definitions, and generation excludes unrelated exceptions from general condition interactions. The acceptance check requires an answer connecting Grappled's Speed 0 to Prone's restriction on righting yourself at Speed 0.

## Evaluation limits

The committed retrieval results include all methods and per-question misses. The questions have been inspected during development, and regression cases informed the fixes. This is not an external holdout set.

Valid source references can still accompany an incorrect inference. Measuring answer accuracy needs independently labeled questions and review of the generated claims. PDF tables can also lose structure during extraction; the original page remains available for comparison.

The Docker deployment has not been runtime-tested. Downloaded sources, model weights, credentials, and local logs are excluded from Git.
