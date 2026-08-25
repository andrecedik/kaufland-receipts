# Docker Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a self-hosted/NAS user pull one container image, mount one folder, and get a working browser UI at `kaufland serve`'s port — no `npm`/`uv` required on their side.

**Architecture:** A multi-stage `Dockerfile` (Node build stage → Python/uv runtime stage) lands the compiled frontend inside the image at `web/public/`, the exact path `export_web_b_data` already writes its runtime data to — so that function needs zero code changes. `create_app` gains a static-files mount at `/` for that directory; `kaufland serve` re-exports once at startup so a container restart shows existing data immediately, not a stale build-time snapshot.

**Tech Stack:** Docker + `docker buildx` (multi-arch: `linux/amd64` + `linux/arm64`), `node:22-slim`, `ghcr.io/astral-sh/uv:python3.12-bookworm-slim`, `docker-compose.yml`.

**Spec:** `docs/superpowers/specs/2026-08-25-docker-packaging-design.md`

## Global Constraints

- Volume mount: one host folder → `/data` in the container. `ReceiptStore` already honors `XDG_DATA_HOME` (`src/kaufland_receipts/store.py:22`) — the image sets `ENV XDG_DATA_HOME=/data`, no store.py changes.
- Single container, single process — `kaufland serve` serves both `/api/*` and the static frontend. No nginx, no split containers.
- Multi-arch (`linux/amd64` + `linux/arm64`) via `docker buildx`, local-only — no registry push, no CI, per the spec's Non-goals.
- No authentication added to `POST /api/upload` — out of scope here (already documented in the README from the Web Upload plan).
- Frontend build output lands in the image at `web/public/` (not a separate `site/`-named directory inside the image) — this is what lets `export_web_b_data` work unmodified.

---

### Task 1: Static file serving in `create_app`

**Files:**
- Modify: `src/kaufland_receipts/server.py`
- Modify: `tests/test_server.py`

**Interfaces:**
- Consumes: nothing new — `create_app(store: ReceiptStore, web_dir: Path) -> FastAPI` (existing signature, unchanged)
- Produces: `GET /` and any other non-`/api/*` path now serve files from `web_dir/public/` (e.g. `GET /assets/app.js` serves `web_dir/public/assets/app.js`); `web_dir/public/` is created if it doesn't already exist

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_server.py`:

```python
def test_static_mount_serves_index_html(tmp_path):
    web_dir = tmp_path / "web"
    (web_dir / "public").mkdir(parents=True)
    (web_dir / "public" / "index.html").write_text("<h1>kaufland-receipts</h1>", encoding="utf-8")
    store = ReceiptStore(data_dir=tmp_path / "data")
    client = TestClient(create_app(store, web_dir))

    res = client.get("/")

    assert res.status_code == 200
    assert "<h1>kaufland-receipts</h1>" in res.text


def test_static_mount_serves_nested_assets(tmp_path):
    web_dir = tmp_path / "web"
    (web_dir / "public" / "assets").mkdir(parents=True)
    (web_dir / "public" / "assets" / "app.js").write_text("console.log('hi')", encoding="utf-8")
    store = ReceiptStore(data_dir=tmp_path / "data")
    client = TestClient(create_app(store, web_dir))

    res = client.get("/assets/app.js")

    assert res.status_code == 200
    assert res.text == "console.log('hi')"


def test_static_mount_handles_missing_public_dir(tmp_path):
    web_dir = tmp_path / "web"  # web_dir/public/ deliberately never created

    client, _store = _client(tmp_path)

    res = client.get("/")

    assert res.status_code == 404
```

Note the third test reuses the existing `_client(tmp_path)` helper (already defined in this file) rather than constructing its own `web_dir`, since `_client` already points `web_dir` at `tmp_path / "web"` without pre-creating `public/` — exactly the "nothing built yet" case this test targets.

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_server.py -v`
Expected: the three new tests FAIL — `test_static_mount_serves_index_html` and `test_static_mount_serves_nested_assets` with 404 (no such route yet), `test_static_mount_handles_missing_public_dir` may error instead if `create_app` doesn't handle a missing directory gracefully once the mount is added — both are acceptable RED states before Step 3.

- [ ] **Step 3: Implement the static mount**

In `src/kaufland_receipts/server.py`, add to the imports:

```python
from fastapi.staticfiles import StaticFiles
```

Replace the file's existing final line (`    return app`) with this block — it ends in `return app` again, so the net effect is inserting the mount right before the function returns, not adding a second return:

```python
    public_dir = web_dir / "public"
    public_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/", StaticFiles(directory=public_dir, html=True), name="static")

    return app
```

This keeps the mount registered after the `/api/upload` route above it, so `/api/*` keeps routing priority over the catch-all static mount.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_server.py -v`
Expected: PASS (all 9 tests: the 6 existing + 3 new)

- [ ] **Step 5: Run the full test suite (regression check)**

Run: `uv run pytest -v`
Expected: PASS — confirms the static mount doesn't shadow `/api/health` or `/api/upload` (both already covered by existing tests in this file, which must still pass unchanged)

- [ ] **Step 6: Commit**

```bash
git add src/kaufland_receipts/server.py tests/test_server.py
git commit -m "feat: serve the built frontend as static files from create_app"
```

---

### Task 2: Re-export on `serve` startup

**Files:**
- Modify: `src/kaufland_receipts/cli.py`
- Modify: `tests/test_cli_serve.py`

**Interfaces:**
- Consumes: `export_mod.export_web_b_data(receipts: list[Receipt], web_dir: Path) -> tuple[int, int]` (`export.py`, already imported in `cli.py` as `export_mod`)
- Produces: no new signature — `kaufland serve` now calls this once at startup, before `uvicorn.run(...)`

- [ ] **Step 1: Write the failing test**

Replace the single test in `tests/test_cli_serve.py` with:

```python
"""Tests for the `serve` CLI command (see CONTEXT.md's Web Upload)."""

from typer.testing import CliRunner

from kaufland_receipts.cli import app

runner = CliRunner()


def test_serve_reexports_before_starting_the_server(tmp_path, monkeypatch):
    calls = []

    def fake_export(receipts, web_dir):
        calls.append(("export", web_dir))

    def fake_run(fastapi_app, host, port):
        calls.append(("run", host, port))

    monkeypatch.setattr("kaufland_receipts.cli.export_mod.export_web_b_data", fake_export)
    monkeypatch.setattr("kaufland_receipts.cli.uvicorn.run", fake_run)
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))

    result = runner.invoke(
        app,
        [
            "serve",
            "--web-dir", str(tmp_path / "web"),
            "--host", "0.0.0.0",
            "--port", "9000",
        ],
    )

    assert result.exit_code == 0, result.output
    assert [c[0] for c in calls] == ["export", "run"]
    assert calls[0][1] == tmp_path / "web"
    assert calls[1][1:] == ("0.0.0.0", 9000)
```

This replaces the plan's earlier `test_serve_builds_the_app_and_calls_uvicorn` test (from the Web Upload plan) — it's superseded, not just extended, since the new test already covers everything the old one did (host/port threading, app construction) plus the new ordering requirement.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_cli_serve.py -v`
Expected: FAIL — `calls` only contains `("run", ...)`, no `"export"` entry, since nothing calls `export_web_b_data` yet

- [ ] **Step 3: Add the startup re-export**

In `src/kaufland_receipts/cli.py`, replace the `serve` command body (currently just `fastapi_app = create_app(_store(), web_dir)` followed by `uvicorn.run(...)`) with:

```python
    store = _store()
    fastapi_app = create_app(store, web_dir)
    export_mod.export_web_b_data(store.all(), web_dir)
    uvicorn.run(fastapi_app, host=host, port=port)
```

(`export_mod` is already imported at the top of `cli.py` — no new import needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_cli_serve.py -v`
Expected: PASS

- [ ] **Step 5: Run the full test suite**

Run: `uv run pytest -v`
Expected: PASS (all tests, including Task 1's)

- [ ] **Step 6: Commit**

```bash
git add src/kaufland_receipts/cli.py tests/test_cli_serve.py
git commit -m "feat: re-export web data on 'kaufland serve' startup"
```

---

### Task 3: Dockerfile + .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: `create_app`'s static mount (Task 1), `serve`'s startup re-export (Task 2) — both must be committed before this task's smoke test can pass
- Produces: a runnable single-platform image (verification below), building block for Task 4's multi-arch + compose work

This task has no automated test — building and smoke-testing a container image has no pytest/vitest surface. Verification is a documented, exact command sequence (Steps 3-4 below), matching how the Web Upload plan verified its Vite dev-proxy.

- [ ] **Step 1: Write the Dockerfile**

Create `Dockerfile` at the repo root:

```dockerfile
# syntax=docker/dockerfile:1

# ---- Stage 1: build the frontend ----
FROM node:22-slim AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- Stage 2: Python runtime ----
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
WORKDIR /app

COPY pyproject.toml uv.lock README.md ./
COPY src/ ./src/
RUN uv sync --frozen --no-dev

# Land the built frontend at web/public/ -- the exact path
# export_web_b_data already writes its runtime output to (receipts.json,
# pdfs/), so that function needs zero changes to work inside the
# container. See docs/superpowers/specs/2026-08-25-docker-packaging-design.md.
# Stage 1's outDir is repo-root site/ (web/vite.config.ts), which from
# /app/web is /app/site.
COPY --from=web-build /app/site/ /app/web/public/

ENV XDG_DATA_HOME=/data
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)" || exit 1

CMD ["kaufland", "serve", "--web-dir", "web", "--host", "0.0.0.0"]
```

- [ ] **Step 2: Write .dockerignore**

Create `.dockerignore` at the repo root:

```
__pycache__/
*.py[oc]
build/
dist/
wheels/
*.egg-info
.venv/
*.pdf
*.mitm
prices.jsonl
/data/
/samples/
export.csv
export.json
/site/
web/node_modules/
web/dist/
web/public/data/receipts.json
.worktrees/
.superpowers/
docs/
.git/
Dockerfile
docker-compose.yml
.dockerignore
```

- [ ] **Step 3: Build a single-platform image for your host's native architecture**

Run: `uname -m` — note the result (`arm64`/`aarch64` → build `linux/arm64`; `x86_64` → build `linux/amd64`).

Run (substituting the platform from above):
```sh
docker build --platform linux/<your-native-arch> -t kaufland-receipts:dev .
```
Expected: build completes with exit code 0, ending in the image being tagged (`kaufland-receipts:dev`) — no error output from either the `npm ci`/`npm run build` stage or the `uv sync` stage.

- [ ] **Step 4: Smoke-test the image**

```sh
mkdir -p /tmp/kaufland-receipts-smoketest
docker run -d --name kaufland-smoketest -p 8000:8000 \
  -v /tmp/kaufland-receipts-smoketest:/data \
  kaufland-receipts:dev

sleep 2
curl -sf http://localhost:8000/api/health
# Expected: {"status":"ok"}

curl -sf http://localhost:8000/
# Expected: HTML output containing the app's root element (an id="root" div or similar from web/index.html)

curl -sf -F "file=@samples/<a-real-sample-pdf>.pdf" http://localhost:8000/api/upload
# Expected: {"status":"added","receipt_id":"...","total":"...","currency":"EUR"}
# (substitute a real path to one of your own receipt PDFs -- samples/ is
# gitignored personal data, not something this plan can name a fixture in)

curl -sf http://localhost:8000/data/receipts.json
# Expected: a JSON array containing the just-uploaded receipt

docker restart kaufland-smoketest
sleep 3
curl -sf http://localhost:8000/data/receipts.json
# Expected: the same receipt still appears -- confirms Task 2's startup
# re-export makes existing /data content visible without a fresh upload

docker stop kaufland-smoketest && docker rm kaufland-smoketest
```

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add Dockerfile for single-container Web Upload deployment"
```

---

### Task 4: docker-compose.yml, multi-arch build, and docs

**Files:**
- Create: `docker-compose.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `Dockerfile` (Task 3)
- Produces: `docker compose up -d` as the documented one-command deployment path; a documented multi-arch build command

- [ ] **Step 1: Write docker-compose.yml**

Create `docker-compose.yml` at the repo root:

```yaml
services:
  kaufland-receipts:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - ./data:/data   # receipts + uploaded PDFs live here on the host -- change the left side to store them elsewhere
    restart: unless-stopped
```

- [ ] **Step 2: Verify docker compose up works**

```sh
docker compose up -d --build
sleep 2
curl -sf http://localhost:8000/api/health
# Expected: {"status":"ok"}
docker compose down
```

- [ ] **Step 3: Build both platforms locally (multi-arch verification)**

A true multi-arch manifest list can only be produced by pushing to a registry (`buildx build --push`), which is out of scope per this plan's Global Constraints. What's verifiable locally is that **both platforms build successfully** — each loaded as its own single-platform local image:

```sh
docker buildx build --platform linux/amd64 -t kaufland-receipts:amd64 --load .
# Expected: exit code 0

docker buildx build --platform linux/arm64 -t kaufland-receipts:arm64 --load .
# Expected: exit code 0
```

If your host's native platform differs from one of these (e.g. building `linux/amd64` on Apple Silicon), that build runs under QEMU emulation — slower, but should still complete. If it fails specifically due to missing emulation support, run `docker run --privileged --rm tonistiigi/binfmt --install all` once (registers QEMU interpreters with the Docker daemon) and retry.

- [ ] **Step 4: Document Docker deployment in the README**

Add a new section to `README.md`, positioned after the existing "Web Upload — alternative to the iCloud watcher" section and before "## Site (shadcn/React)":

```markdown
## Docker

For a NAS/self-hosted deployment: one container runs both the API and the
built frontend (no separate `npm run dev` needed, unlike the two-process
dev flow above).

```sh
docker compose up -d --build
```

Receipts and uploaded PDFs persist in `./data` on the host (edit
`docker-compose.yml`'s volume line to store them elsewhere) — this is the
same `XDG_DATA_HOME`-backed store the CLI and dev workflow use, just
mounted at `/data` inside the container. **This volume mount is required**
— running the container without it (e.g. a plain `docker run` with no
`-v`) still works, but everything is written to the container's own
writable layer instead, and is permanently lost the moment the container
is removed.

Building for a specific platform (the image supports both `linux/amd64`
and `linux/arm64`):

```sh
docker build --platform linux/amd64 -t kaufland-receipts .    # or linux/arm64
```

Same no-auth caveat as `kaufland serve` above: don't expose port 8000
beyond a trusted network without adding auth in front of it (e.g. a
reverse proxy).
```

- [ ] **Step 5: Update the Status checklist**

In `README.md`'s `## Status` section, add a line after the existing Web Upload entry:

```markdown
- [x] Docker packaging (`docker compose up -d`) — single container, serves
      both the API and the built frontend; multi-arch (amd64/arm64) build
      supported, not yet published to a registry
```

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml README.md
git commit -m "feat: add docker-compose.yml, multi-arch build, and Docker README docs"
```
