# Web Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `POST /api/upload` HTTP endpoint plus a browser UI so a user can drag a Kaufland receipt PDF into the web app and have it parsed and stored — the ingestion path that works on any host OS/NAS platform, unlike the existing Folder Watch (iCloud-only, Mac-only).

**Architecture:** A new FastAPI app (`server.py`) wraps the existing `parse_pdf` / `ReceiptStore` / `export_web_b_data` functions behind one endpoint — no changes to the parsing or storage logic itself, just a new entrypoint into it. A new `kaufland serve` CLI command runs it via `uvicorn`. The React app gets a new `/upload` route that POSTs to this endpoint; a Vite dev-server proxy forwards `/api/*` to the Python server during `npm run dev` so both can run side by side.

**Tech Stack:** FastAPI + uvicorn + python-multipart (new Python deps), existing pydantic models, existing React/shadcn/vitest stack.

**Spec:** `CONTEXT.md` (Web Upload, Folder Watch, Self-Hosted Distribution, Analytics Surface terms) and `docs/adr/0001-self-hosted-before-hosted-saas.md`, `docs/adr/0002-initial-audience-is-selfhosted-ha-niche.md` — both in the repo root / `docs/adr/`.

## Global Constraints

- Receipts never leave the user's own infrastructure — the upload endpoint must make no outbound network calls (Self-Hosted Distribution, `CONTEXT.md`).
- No telemetry/analytics of any kind is added anywhere in this feature (resolved in the business-case grilling session — silent phone-home was explicitly rejected).
- Folder Watch (`watch.py`, `kaufland watch`) is unaffected — Web Upload is an additional ingestion path, not a replacement.
- Frontend code follows the existing web/ conventions: named function-component exports, `@/` path alias, shadcn `ui/` components, vitest + `@testing-library/react` with `@vitest-environment jsdom`.

---

### Task 1: FastAPI app skeleton with a health check

**Files:**
- Create: `src/kaufland_receipts/server.py`
- Create: `tests/test_server.py`
- Modify: `pyproject.toml`

**Interfaces:**
- Produces: `create_app(store: ReceiptStore, web_dir: Path) -> FastAPI`

- [ ] **Step 1: Add the new dependencies**

Edit `pyproject.toml` — add to `[project] dependencies`:

```toml
dependencies = [
    "pydantic>=2.13.4",
    "pypdf>=6.16.1",
    "typer>=0.12",
    "fastapi>=0.121",
    "uvicorn[standard]>=0.35",
    "python-multipart>=0.0.20",
]
```

And add `httpx` (required by FastAPI's `TestClient`) to `[dependency-groups] dev`:

```toml
[dependency-groups]
dev = [
    "pytest>=9.1.1",
    "httpx>=0.28",
]
```

Run: `uv sync`

- [ ] **Step 2: Write the failing test**

Create `tests/test_server.py`:

```python
"""Tests for the Web Upload HTTP endpoint (see CONTEXT.md's Web Upload)."""

from fastapi.testclient import TestClient

from kaufland_receipts.server import create_app
from kaufland_receipts.store import ReceiptStore


def _client(tmp_path):
    store = ReceiptStore(data_dir=tmp_path / "data")
    app = create_app(store, web_dir=tmp_path / "web")
    return TestClient(app), store


def test_health_check(tmp_path):
    client, _store = _client(tmp_path)

    res = client.get("/api/health")

    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `uv run pytest tests/test_server.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kaufland_receipts.server'`

- [ ] **Step 4: Write minimal implementation**

Create `src/kaufland_receipts/server.py`:

```python
"""HTTP server exposing receipt ingestion over the network.

Backs the Web Upload ingestion path (see CONTEXT.md): unlike Folder Watch,
which only works on a Mac with iCloud Drive, this lets any browser --
Docker/NAS deployments included -- drop a receipt PDF in and have it parsed
and stored.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI

from .store import ReceiptStore


def create_app(store: ReceiptStore, web_dir: Path) -> FastAPI:
    app = FastAPI()

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/test_server.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml uv.lock src/kaufland_receipts/server.py tests/test_server.py
git commit -m "feat: add FastAPI app skeleton for Web Upload"
```

---

### Task 2: `POST /api/upload` — parse, store, dedupe, validate

**Files:**
- Modify: `src/kaufland_receipts/server.py`
- Modify: `tests/test_server.py`

**Interfaces:**
- Consumes: `parse_pdf(path: Path) -> Receipt` (`parse_pdf.py`), `ReceiptStore.save(receipt, overwrite=False) -> bool`, `ReceiptStore.data_dir: Path`, `ReceiptStore.all() -> list[Receipt]` (`store.py`)
- Produces: `POST /api/upload` — `200 {"status": "added", "receipt_id": str, "total": str, "currency": str}` | `200 {"status": "duplicate", "receipt_id": str}` | `422 {"detail": str}`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_server.py` (add `from pathlib import Path` to the top-of-file imports):

```python
SAMPLE_PDF = Path(__file__).parent.parent / "samples" / "20260821_233939.pdf"


def test_upload_adds_a_new_receipt(tmp_path):
    client, store = _client(tmp_path)

    with SAMPLE_PDF.open("rb") as f:
        res = client.post(
            "/api/upload", files={"file": (SAMPLE_PDF.name, f, "application/pdf")}
        )

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "added"
    assert body["receipt_id"]
    assert len(store.all()) == 1


def test_upload_is_idempotent(tmp_path):
    client, store = _client(tmp_path)
    with SAMPLE_PDF.open("rb") as f:
        client.post("/api/upload", files={"file": (SAMPLE_PDF.name, f, "application/pdf")})

    with SAMPLE_PDF.open("rb") as f:
        res = client.post(
            "/api/upload", files={"file": (SAMPLE_PDF.name, f, "application/pdf")}
        )

    assert res.status_code == 200
    assert res.json()["status"] == "duplicate"
    assert len(store.all()) == 1


def test_upload_rejects_a_non_pdf(tmp_path):
    client, store = _client(tmp_path)

    res = client.post(
        "/api/upload", files={"file": ("receipt.txt", b"not a pdf", "text/plain")}
    )

    assert res.status_code == 422
    assert store.all() == []


def test_upload_reports_a_parse_failure(tmp_path):
    client, store = _client(tmp_path)

    res = client.post(
        "/api/upload",
        files={"file": ("receipt.pdf", b"%PDF-1.4 not really a receipt", "application/pdf")},
    )

    assert res.status_code == 422
    assert store.all() == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_server.py -v`
Expected: FAIL — `404` (no such route) on the first three, and the fourth fails differently or errors, since `/api/upload` doesn't exist yet.

- [ ] **Step 3: Implement the endpoint**

Replace the contents of `src/kaufland_receipts/server.py` with:

```python
"""HTTP server exposing receipt ingestion over the network.

Backs the Web Upload ingestion path (see CONTEXT.md): unlike Folder Watch,
which only works on a Mac with iCloud Drive, this lets any browser --
Docker/NAS deployments included -- drop a receipt PDF in and have it parsed
and stored.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile

from .parse_pdf import parse_pdf
from .store import ReceiptStore


def create_app(store: ReceiptStore, web_dir: Path) -> FastAPI:
    app = FastAPI()
    uploads_dir = store.data_dir / "uploads"

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/upload")
    async def upload(file: UploadFile = File(...)) -> dict[str, str]:
        if not (file.filename or "").lower().endswith(".pdf"):
            raise HTTPException(422, detail="Only PDF files are supported.")

        # Persisted under a unique name (not the original filename) so two
        # uploads that happen to share a name never collide; parse_pdf reads
        # from this final path, so `Receipt.source_file` points here for
        # good, matching what export_web_b_data expects downstream.
        uploads_dir.mkdir(parents=True, exist_ok=True)
        dest = uploads_dir / f"{uuid.uuid4().hex[:8]}-{file.filename}"
        dest.write_bytes(await file.read())

        try:
            receipt = parse_pdf(dest)
        except Exception as exc:
            raise HTTPException(422, detail=str(exc)) from exc

        if not store.save(receipt):
            return {"status": "duplicate", "receipt_id": receipt.receipt_id}

        return {
            "status": "added",
            "receipt_id": receipt.receipt_id,
            "total": str(receipt.total),
            "currency": receipt.currency,
        }

    return app
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_server.py -v`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/kaufland_receipts/server.py tests/test_server.py
git commit -m "feat: implement POST /api/upload — parse, store, dedupe, validate"
```

---

### Task 3: Refresh `receipts.json` / `pdfs/` after a successful upload

**Files:**
- Modify: `src/kaufland_receipts/server.py`
- Modify: `tests/test_server.py`

**Interfaces:**
- Consumes: `export_mod.export_web_b_data(receipts: list[Receipt], web_dir: Path) -> tuple[int, int]` (`export.py`)
- Produces: no new signature — `POST /api/upload`'s `"added"` response now has the side effect of writing `web_dir/public/data/receipts.json` and `web_dir/public/pdfs/<receipt_id>.pdf`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_server.py` (add `import json` to the top-of-file imports):

```python
def test_upload_refreshes_the_web_data(tmp_path):
    client, _store = _client(tmp_path)
    web_dir = tmp_path / "web"

    with SAMPLE_PDF.open("rb") as f:
        client.post("/api/upload", files={"file": (SAMPLE_PDF.name, f, "application/pdf")})

    receipts_json = web_dir / "public" / "data" / "receipts.json"
    assert receipts_json.exists()
    data = json.loads(receipts_json.read_text("utf-8"))
    assert len(data) == 1

    receipt_id = data[0]["receipt_id"]
    assert (web_dir / "public" / "pdfs" / f"{receipt_id}.pdf").exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_server.py::test_upload_refreshes_the_web_data -v`
Expected: FAIL — `receipts.json` doesn't exist, since nothing writes it yet.

- [ ] **Step 3: Wire the export call**

In `src/kaufland_receipts/server.py`:

Add to the imports:

```python
from . import export as export_mod
```

Replace the `"added"` return in the `upload` handler:

```python
        if not store.save(receipt):
            return {"status": "duplicate", "receipt_id": receipt.receipt_id}

        export_mod.export_web_b_data(store.all(), web_dir)

        return {
            "status": "added",
            "receipt_id": receipt.receipt_id,
            "total": str(receipt.total),
            "currency": receipt.currency,
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_server.py -v`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/kaufland_receipts/server.py tests/test_server.py
git commit -m "feat: refresh receipts.json/pdfs after a successful upload"
```

---

### Task 4: `kaufland serve` CLI command

**Files:**
- Modify: `src/kaufland_receipts/cli.py`
- Create: `tests/test_cli_serve.py`

**Interfaces:**
- Consumes: `create_app(store: ReceiptStore, web_dir: Path) -> FastAPI` (Task 1)
- Produces: `kaufland serve [--web-dir PATH] [--host HOST] [--port PORT]` CLI command

- [ ] **Step 1: Write the failing test**

Create `tests/test_cli_serve.py`:

```python
"""Tests for the `serve` CLI command (see CONTEXT.md's Web Upload)."""

from typer.testing import CliRunner

from kaufland_receipts.cli import app

runner = CliRunner()


def test_serve_builds_the_app_and_calls_uvicorn(tmp_path, monkeypatch):
    captured = {}

    def fake_run(fastapi_app, host, port):
        captured["app"] = fastapi_app
        captured["host"] = host
        captured["port"] = port

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
    assert captured["host"] == "0.0.0.0"
    assert captured["port"] == 9000
    assert captured["app"] is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_cli_serve.py -v`
Expected: FAIL — `No such command 'serve'`

- [ ] **Step 3: Add the command**

In `src/kaufland_receipts/cli.py`, add to the imports:

```python
import uvicorn

from .server import create_app
```

Add the command (anywhere after `_store()` is defined):

```python
@app.command()
def serve(
    web_dir: Path = typer.Option(Path("web"), help="Path to the web/ (shadcn variant) project."),
    host: str = typer.Option("127.0.0.1", help="Host to bind."),
    port: int = typer.Option(8000, help="Port to bind."),
):
    """Run the Web Upload server: accepts receipt PDFs at POST /api/upload
    and re-exports web/public/data/receipts.json after each one.
    """
    fastapi_app = create_app(_store(), web_dir)
    uvicorn.run(fastapi_app, host=host, port=port)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_cli_serve.py -v`
Expected: PASS

- [ ] **Step 5: Run the full Python test suite**

Run: `uv run pytest -v`
Expected: PASS (all tests, including Tasks 1-3's)

- [ ] **Step 6: Commit**

```bash
git add src/kaufland_receipts/cli.py tests/test_cli_serve.py
git commit -m "feat: add 'kaufland serve' command"
```

---

### Task 5: Vite dev-server proxy for `/api`

**Files:**
- Modify: `web/vite.config.ts`

**Interfaces:**
- Consumes: `kaufland serve`'s default `http://127.0.0.1:8000` (Task 4)
- Produces: during `npm run dev`, requests to `/api/*` from the browser reach the Python server

- [ ] **Step 1: Add the proxy config**

In `web/vite.config.ts`, add a `server` block:

```ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(dirname, './src'),
    },
  },
  server: {
    // Forwards Web Upload's /api/* calls to `kaufland serve` (default
    // 127.0.0.1:8000) during local dev, so the browser can call fetch("/api/...")
    // without a CORS/absolute-URL dance.
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  build: {
    outDir: '../site-b',
    emptyOutDir: true,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
})
```

- [ ] **Step 2: Manually verify the proxy**

Run in one terminal: `uv run kaufland serve --web-dir web`
Run in another terminal: `cd web && npm run dev` (note the printed local URL, typically `http://localhost:5173`)
Run: `curl http://localhost:5173/api/health`
Expected: `{"status":"ok"}`

- [ ] **Step 3: Commit**

```bash
git add web/vite.config.ts
git commit -m "feat: proxy /api to the Web Upload server during npm run dev"
```

---

### Task 6: `UploadPage` — browser UI for Web Upload

**Files:**
- Create: `web/src/pages/UploadPage.tsx`
- Create: `web/src/pages/UploadPage.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `POST /api/upload` — `200 {"status": "added", "receipt_id": str, "total": str, "currency": str}` | `200 {"status": "duplicate", "receipt_id": str}` | `422 {"detail": str}` (Task 2/3)
- Produces: `export function UploadPage()`, route `/upload`

- [ ] **Step 1: Write the failing tests**

Create `web/src/pages/UploadPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UploadPage } from "./UploadPage"

afterEach(cleanup)

const PDF = new File(["%PDF-1.4"], "receipt.pdf", { type: "application/pdf" })

function selectFile(input: HTMLElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

describe("UploadPage", () => {
  it("uploads the selected file and shows the added total", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "added", receipt_id: "r1", total: "12.34", currency: "EUR" }),
    })
    render(<UploadPage />)

    selectFile(screen.getByLabelText("Receipt PDF"), PDF)
    fireEvent.click(screen.getByRole("button", { name: /upload receipt/i }))

    await waitFor(() => expect(screen.getByText(/added/i)).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledWith("/api/upload", expect.objectContaining({ method: "POST" }))
  })

  it("shows a duplicate message when the receipt is already stored", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "duplicate", receipt_id: "r1" }),
    })
    render(<UploadPage />)

    selectFile(screen.getByLabelText("Receipt PDF"), PDF)
    fireEvent.click(screen.getByRole("button", { name: /upload receipt/i }))

    await waitFor(() => expect(screen.getByText(/already in the store/i)).toBeInTheDocument())
  })

  it("shows the server's error detail on a failed upload", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Only PDF files are supported." }),
    })
    render(<UploadPage />)

    selectFile(screen.getByLabelText("Receipt PDF"), PDF)
    fireEvent.click(screen.getByRole("button", { name: /upload receipt/i }))

    await waitFor(() =>
      expect(screen.getByText("Only PDF files are supported.")).toBeInTheDocument(),
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/pages/UploadPage.test.tsx`
Expected: FAIL — `Failed to resolve import "./UploadPage"`

- [ ] **Step 3: Implement the component**

Create `web/src/pages/UploadPage.tsx`:

```tsx
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "added"; total: string; currency: string }
  | { kind: "duplicate" }
  | { kind: "error"; message: string }

export function UploadPage() {
  const [file, setFile] = useState<File | null>(null)
  const [state, setState] = useState<UploadState>({ kind: "idle" })

  async function handleUpload() {
    if (!file) return
    setState({ kind: "uploading" })

    const body = new FormData()
    body.append("file", file)

    try {
      const res = await fetch("/api/upload", { method: "POST", body })
      const data = await res.json()
      if (!res.ok) {
        setState({ kind: "error", message: data.detail ?? "Upload failed." })
        return
      }
      if (data.status === "duplicate") {
        setState({ kind: "duplicate" })
      } else {
        setState({ kind: "added", total: data.total, currency: data.currency })
      }
    } catch {
      setState({ kind: "error", message: "Could not reach the server." })
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <input
          type="file"
          accept="application/pdf"
          aria-label="Receipt PDF"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button onClick={handleUpload} disabled={!file || state.kind === "uploading"}>
          {state.kind === "uploading" ? "Uploading..." : "Upload receipt"}
        </Button>
        {state.kind === "added" && (
          <p className="text-sm text-muted-foreground">
            Added — {state.total} {state.currency}.
          </p>
        )}
        {state.kind === "duplicate" && (
          <p className="text-sm text-muted-foreground">Already in the store.</p>
        )}
        {state.kind === "error" && <p className="text-sm text-destructive">{state.message}</p>}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/pages/UploadPage.test.tsx`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Wire the route**

In `web/src/App.tsx`, add the lazy import alongside the others:

```tsx
const UploadPage = lazy(() => import("@/pages/UploadPage").then((m) => ({ default: m.UploadPage })))
```

Add the route inside `<Route element={<Layout />}>`:

```tsx
<Route path="upload" element={<UploadPage />} />
```

- [ ] **Step 6: Add the nav tab**

In `web/src/components/Layout.tsx`, add to `TABS`:

```tsx
const TABS = [
  { to: "/", label: "Receipts", end: true },
  { to: "/upload", label: "Upload", end: false },
  { to: "/stats", label: "Statistics", end: false },
]
```

- [ ] **Step 7: Run the full frontend test suite and lint**

Run: `cd web && npm test && npm run lint`
Expected: PASS, no lint errors

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/UploadPage.tsx web/src/pages/UploadPage.test.tsx web/src/App.tsx web/src/components/Layout.tsx
git commit -m "feat: add Upload page, route, and nav tab"
```
