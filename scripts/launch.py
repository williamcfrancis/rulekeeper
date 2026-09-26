"""Open an installed RuleKeeper checkout, reusing running local services."""

import json
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

import httpx

from rulekeeper.config import Settings

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / ".local"


def healthy(url: str) -> bool:
    try:
        return httpx.get(url, timeout=2).status_code == 200
    except httpx.HTTPError:
        return False


def main():
    settings = Settings()
    LOCAL.mkdir(exist_ok=True)
    if not (settings.index_dir / "manifest.json").exists():
        raise SystemExit("Run python -m rulekeeper ingest first. See README.md for setup.")
    if not (ROOT / "web/dist/index.html").exists():
        raise SystemExit("Build the web interface first: cd web, npm ci, npm run build.")
    if settings.provider == "local" and not healthy(
        f"{settings.local_base_url.removesuffix('/v1')}/health"
    ):
        manifest = LOCAL / "model-manifest.json"
        if not manifest.exists():
            raise SystemExit("Start your model server first, or run scripts/setup_local_model.py.")
        backend = json.loads(manifest.read_text(encoding="utf-8")).get("backend", "cpu")
        subprocess.run(
            [sys.executable, str(ROOT / "scripts/setup_local_model.py"), "--backend", backend],
            check=True,
        )
    if not healthy("http://127.0.0.1:8000/api/health"):
        with (
            (LOCAL / "api.stdout.log").open("w") as out,
            (LOCAL / "api.stderr.log").open("w") as err,
        ):
            process = subprocess.Popen(
                [sys.executable, "-m", "rulekeeper", "serve"],
                cwd=ROOT,
                stdout=out,
                stderr=err,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
        (LOCAL / "api.pid").write_text(str(process.pid), encoding="utf-8")
        for _ in range(30):
            if process.poll() is not None:
                raise SystemExit("RuleKeeper could not start. See .local/api.stderr.log.")
            if healthy("http://127.0.0.1:8000/api/health"):
                break
            time.sleep(1)
        else:
            raise SystemExit("RuleKeeper startup timed out. See .local/api.stderr.log.")
    webbrowser.open("http://127.0.0.1:8000")
    print("RuleKeeper is running at http://127.0.0.1:8000", flush=True)


if __name__ == "__main__":
    main()
