"""Install a pinned, optional llama.cpp runtime and Qwen model on Windows.

Everything stays inside the ignored .local directory. No admin access, API key,
system PATH changes, or global install is needed. Download size is about 2.6 GB.
"""

import argparse
import hashlib
import json
import platform
import subprocess
import time
import zipfile
from pathlib import Path

import httpx
from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / ".local"
BINARY_URL = "https://github.com/ggml-org/llama.cpp/releases/download/b11205/llama-b11205-bin-win-cpu-x64.zip"
BINARY_HASH = "2a8bf1ff808e8f6d2329f50f7005419a9930d9ecfbeae5047cfff475e87c2db0"
VULKAN_URL = "https://github.com/ggml-org/llama.cpp/releases/download/b11205/llama-b11205-bin-win-vulkan-x64.zip"
VULKAN_HASH = "f3d08e7e342e2cb96ccddd1a208320c188d0a394844553a40a32c5e9903af563"
MODEL_REPO = "Qwen/Qwen3-4B-GGUF"
MODEL_REVISION = "bc640142c66e1fdd12af0bd68f40445458f3869b"
MODEL_FILE = "Qwen3-4B-Q4_K_M.gguf"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", choices=["cpu", "vulkan"], default="cpu")
    args = parser.parse_args()
    if platform.system() != "Windows":
        raise SystemExit(
            "This optional installer is for Windows. On other systems use llama.cpp or Ollama; see README."
        )
    try:
        response = httpx.get("http://127.0.0.1:8081/v1/models", timeout=2)
        if response.status_code == 200:
            if any(model.get("id") == "qwen3-4b" for model in response.json().get("data", [])):
                print("The qwen3-4b server is already running on port 8081; reusing it.")
                return
            raise SystemExit(
                "Port 8081 already serves another model. Stop it before installing RuleKeeper's model."
            )
    except httpx.HTTPError:
        pass
    LOCAL.mkdir(exist_ok=True)
    archive = LOCAL / f"llama-b11205-{args.backend}.zip"
    url = VULKAN_URL if args.backend == "vulkan" else BINARY_URL
    expected_hash = VULKAN_HASH if args.backend == "vulkan" else BINARY_HASH
    if not archive.exists():
        print(f"Downloading the pinned llama.cpp {args.backend} runtime...", flush=True)
        with httpx.stream("GET", url, follow_redirects=True, timeout=120) as response:
            response.raise_for_status()
            with archive.open("wb") as output:
                for block in response.iter_bytes():
                    output.write(block)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected_hash:
        raise SystemExit(f"Runtime checksum mismatch. Remove {archive.name} and retry.")
    runtime = LOCAL / f"llama-{args.backend}"
    with zipfile.ZipFile(archive) as zipped:
        for member in zipped.infolist():
            if not (runtime / member.filename).resolve().is_relative_to(runtime.resolve()):
                raise SystemExit("Unsafe path in runtime archive")
        zipped.extractall(runtime)
    print("Downloading the pinned Qwen3 4B model (about 2.5 GB)...", flush=True)
    model = hf_hub_download(
        MODEL_REPO, MODEL_FILE, revision=MODEL_REVISION, local_dir=str(LOCAL / "models")
    )
    (LOCAL / "model-manifest.json").write_text(
        json.dumps(
            {
                "model_repo": MODEL_REPO,
                "revision": MODEL_REVISION,
                "file": MODEL_FILE,
                "license": "Apache-2.0",
                "runtime": "llama.cpp b11205",
                "runtime_sha256": expected_hash,
                "backend": args.backend,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    executable = next(runtime.rglob("llama-server.exe"))
    with (
        (LOCAL / "model.stdout.log").open("w") as out,
        (LOCAL / "model.stderr.log").open("w") as err,
    ):
        arguments = [
            str(executable),
            "-m",
            model,
            "--host",
            "127.0.0.1",
            "--port",
            "8081",
            "-c",
            "6144",
            "-t",
            "6",
            "--parallel",
            "1",
            "--alias",
            "qwen3-4b",
            "--jinja",
        ]
        if args.backend == "vulkan":
            arguments.extend(["-ngl", "99"])
        process = subprocess.Popen(
            arguments, stdout=out, stderr=err, creationflags=subprocess.CREATE_NO_WINDOW, cwd=ROOT
        )
    (LOCAL / "model.pid").write_text(str(process.pid), encoding="utf-8")
    for _ in range(60):
        if process.poll() is not None:
            raise SystemExit("The model server failed to start. Inspect .local/model.stderr.log.")
        try:
            if httpx.get("http://127.0.0.1:8081/health", timeout=2).status_code == 200:
                print(
                    f"Local server ready (PID {process.pid}, {args.backend}). Set RULEKEEPER_PROVIDER=local in .env.",
                    flush=True,
                )
                return
        except httpx.HTTPError:
            pass
        time.sleep(1)
    raise SystemExit("Model startup timed out. Inspect .local/model.stderr.log.")


if __name__ == "__main__":
    main()
