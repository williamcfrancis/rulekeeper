# Third-party notices

## System Reference Document 5.2.1

This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

RuleKeeper extracts and normalizes the source text, divides it into passages, and may generate explanations adapted from retrieved passages. The original source remains available through page links. This is an independent project.

The source PDF and derived search index are downloaded/generated during setup; they are not checked into Git. Source URL and SHA-256 are pinned in `src/rulekeeper/config.py` and recorded in the generated manifest. This notice must accompany any redistributed SRD text or adaptations.

## Models and runtime

- `sentence-transformers/all-MiniLM-L6-v2`: Apache-2.0. FastEmbed downloads its supported ONNX conversion. https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
- `Xenova/ms-marco-MiniLM-L-6-v2`: Apache-2.0. https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2
- Optional `Qwen/Qwen3-4B-GGUF`: Apache-2.0. https://huggingface.co/Qwen/Qwen3-4B-GGUF
- Optional llama.cpp runtime: MIT. https://github.com/ggml-org/llama.cpp

Model weights and runtime binaries are not redistributed in this repository. The optional Windows installer pins the runtime asset checksum and Qwen model revision. Embedding/reranking downloads follow FastEmbed's model registry; its version is locked, but those model repositories are not revision-pinned. For an exact experiment, preserve the model cache and record its file hashes.

## Fonts and icons

- DM Sans and Libre Baskerville: SIL Open Font License 1.1, distributed by `@fontsource` with their license files.
- Lucide icons: ISC license. https://lucide.dev/license
- The RuleKeeper die mark and book illustration are original SVG/CSS assets in this repository.

Other dependencies retain their licenses; the Python and npm lock files identify exact tested package versions.
