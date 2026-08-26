# Multi-File Web Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user select and upload several receipt PDFs at once through the Web Upload UI, instead of one file per round trip.

**Architecture:** Client-only change. `UploadPage.tsx` moves from a single `File | null` + one `UploadState` to an array of `UploadRow` (`{ file, status }`), one per selected file. Selecting files populates the rows as `pending`; clicking "Upload receipts" walks the array with a sequential `for` loop, awaiting each `POST /api/upload` before starting the next, and updates that row's status in place as each request settles. `server.py`'s `POST /api/upload` endpoint is untouched — it already handles exactly one file per call, parses it, stores it, dedupes it, and re-exports `receipts.json`/`pdfs/`; this plan just calls it N times instead of once.

**Tech Stack:** Existing React 19 + TypeScript + shadcn `ui/` components (`Button`, `Card`) + vitest + `@testing-library/react` (jsdom environment). No new dependencies.

**Spec:** `CONTEXT.md`'s **Web Upload** term (already updated in this design session to read "selecting one or more receipt PDFs into the web UI's file picker" and to drop an inaccurate PDF/PNG claim) and `docs/superpowers/plans/2026-08-25-web-upload.md` (the original single-file implementation this plan extends — `UploadPage.tsx`'s existing shape, `server.py`'s `POST /api/upload` contract, and the Global Constraints that still apply). Design decisions below came out of a `/grill-with-docs` session in this same conversation, not a separate written spec doc.

## Global Constraints

- Sequential per-file requests only — never `Promise.all` or otherwise concurrent `POST /api/upload` calls. A self-hosted/NAS deployment (`CONTEXT.md`'s Web Upload, `docs/adr/0002-initial-audience-is-selfhosted-ha-niche.md`) shouldn't be hit with N concurrent `parse_pdf` + full-store `export_web_data` calls from one batch.
- Continue past a per-file failure — one bad PDF must not stop the rest of the batch from uploading. Matches `watch.py`'s `scan_once`, which already collects `(added, errors)` across a whole directory rather than aborting at the first bad file.
- No change to `server.py`'s `POST /api/upload` contract or response shape — this plan is entirely a `web/src/pages/UploadPage.tsx` change.
- No optimization of the per-file `export_web_data` re-export inside `POST /api/upload` — leave the existing "one full re-export per successful upload" behavior as-is; don't add a batch-end-only export mode.
- No cancel button, no `AbortController` — once started, a batch runs to completion.
- File selection is a plain `<input type="file" multiple>` — no drag-and-drop.
- PDF only — `accept="application/pdf"` on the input, matching `server.py:32`'s `.pdf`-only check and `CONTEXT.md`'s corrected Web Upload term.
- Frontend code follows existing `web/` conventions: named function-component exports, `@/` path alias, shadcn `ui/` components, vitest + `@testing-library/react` with `@vitest-environment jsdom`.

---

### Task 1: Multi-file selection with per-file pending rows

**Files:**
- Modify: `web/src/pages/UploadPage.tsx`
- Modify: `web/src/pages/UploadPage.test.tsx`

**Interfaces:**
- Consumes: `Button` (`@/components/ui/button`), `Card`/`CardContent` (`@/components/ui/card`) — unchanged imports from the existing single-file version.
- Produces: `type RowStatus = { kind: "pending" } | { kind: "uploading" } | { kind: "added"; total: string; currency: string } | { kind: "duplicate" } | { kind: "error"; message: string }` and `type UploadRow = { file: File; status: RowStatus }`, plus `rows: UploadRow[]` component state. Task 2 drives its upload loop off this exact shape — `rows[i].file` to read, and updating `rows[i].status` to reflect progress.

- [ ] **Step 1: Write the failing test**

Replace the full contents of `web/src/pages/UploadPage.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { UploadPage } from "./UploadPage"

afterEach(cleanup)

function makePdf(name: string) {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" })
}

function selectFiles(input: HTMLElement, files: File[]) {
  fireEvent.change(input, { target: { files } })
}

describe("UploadPage", () => {
  it("renders a pending row for each selected file", () => {
    render(<UploadPage />)

    selectFiles(screen.getByLabelText("Receipt PDFs"), [
      makePdf("receipt-1.pdf"),
      makePdf("receipt-2.pdf"),
    ])

    expect(screen.getByText("receipt-1.pdf")).toBeTruthy()
    expect(screen.getByText("receipt-2.pdf")).toBeTruthy()
    expect(screen.getAllByText("Pending")).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/UploadPage.test.tsx`
Expected: FAIL — `getByLabelText("Receipt PDFs")` finds nothing (the existing input is labeled `"Receipt PDF"` and only accepts one file).

- [ ] **Step 3: Write the implementation**

Replace the full contents of `web/src/pages/UploadPage.tsx` with:

```tsx
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

type RowStatus =
  | { kind: "pending" }
  | { kind: "uploading" }
  | { kind: "added"; total: string; currency: string }
  | { kind: "duplicate" }
  | { kind: "error"; message: string }

type UploadRow = {
  file: File
  status: RowStatus
}

export function UploadPage() {
  const [rows, setRows] = useState<UploadRow[]>([])

  function handleSelect(fileList: FileList | null) {
    const files = fileList ? Array.from(fileList) : []
    setRows(files.map((file) => ({ file, status: { kind: "pending" } })))
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <input
          type="file"
          accept="application/pdf"
          multiple
          aria-label="Receipt PDFs"
          onChange={(e) => handleSelect(e.target.files)}
        />
        <Button disabled={rows.length === 0}>Upload receipts</Button>
        {rows.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {rows.map((row, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span className="truncate">{row.file.name}</span>
                <RowStatusLabel status={row.status} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function RowStatusLabel({ status }: { status: RowStatus }) {
  switch (status.kind) {
    case "pending":
      return <span className="text-muted-foreground">Pending</span>
    case "uploading":
      return <span className="text-muted-foreground">Uploading...</span>
    case "added":
      return (
        <span className="text-muted-foreground">
          Added — {status.total} {status.currency}
        </span>
      )
    case "duplicate":
      return <span className="text-muted-foreground">Already in the store</span>
    case "error":
      return <span className="text-destructive">{status.message}</span>
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/pages/UploadPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/UploadPage.tsx web/src/pages/UploadPage.test.tsx
git commit -m "feat: render a pending row per selected file in Web Upload"
```

---

### Task 2: Sequential upload loop, wired to the button

**Files:**
- Modify: `web/src/pages/UploadPage.tsx`
- Modify: `web/src/pages/UploadPage.test.tsx`

**Interfaces:**
- Consumes: `UploadRow`, `RowStatus`, `rows` state (Task 1); `POST /api/upload` — `200 {"status": "added", "receipt_id": str, "total": str, "currency": str}` | `200 {"status": "duplicate", "receipt_id": str}` | `422 {"detail": str}` (`server.py`, unchanged).
- Produces: `handleUpload()` — awaits one `fetch("/api/upload", ...)` per row in array order, updating that row's `status` to `"uploading"` before the call and to its final state after, before moving to the next row. Button's `onClick` and `disabled` now wired to this and to a new `uploading: boolean` state.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/pages/UploadPage.test.tsx` (add `waitFor` to the existing `@testing-library/react` import, and `beforeEach`, `vi` to the existing `vitest` import — the top of the file becomes):

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UploadPage } from "./UploadPage"
```

Add right after the existing `afterEach(cleanup)` line:

```tsx
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
```

Add these tests inside the existing `describe("UploadPage", ...)` block, after the `"renders a pending row for each selected file"` test:

```tsx
  it("uploads each selected file and shows the final status per row", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "added", receipt_id: "r1", total: "12.34", currency: "EUR" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "duplicate", receipt_id: "r2" }),
      })
    render(<UploadPage />)
    selectFiles(screen.getByLabelText("Receipt PDFs"), [
      makePdf("receipt-1.pdf"),
      makePdf("receipt-2.pdf"),
    ])

    fireEvent.click(screen.getByRole("button", { name: /upload receipts/i }))

    await waitFor(() => {
      expect(screen.getByText("receipt-1.pdf").closest("li")?.textContent).toContain("Added")
      expect(screen.getByText("receipt-2.pdf").closest("li")?.textContent).toContain(
        "Already in the store",
      )
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("continues past a failed file and uploads the rest", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: "Only PDF files are supported." }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "added", receipt_id: "r2", total: "5.00", currency: "EUR" }),
      })
    render(<UploadPage />)
    selectFiles(screen.getByLabelText("Receipt PDFs"), [
      makePdf("bad.pdf"),
      makePdf("receipt-2.pdf"),
    ])

    fireEvent.click(screen.getByRole("button", { name: /upload receipts/i }))

    await waitFor(() => {
      expect(screen.getByText("bad.pdf").closest("li")?.textContent).toContain(
        "Only PDF files are supported.",
      )
      expect(screen.getByText("receipt-2.pdf").closest("li")?.textContent).toContain("Added")
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("uploads one file at a time, not in parallel", async () => {
    const first = deferred<{ ok: boolean; json: () => Promise<unknown> }>()
    const second = deferred<{ ok: boolean; json: () => Promise<unknown> }>()
    const fetchMock = fetch as ReturnType<typeof vi.fn>
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<UploadPage />)
    selectFiles(screen.getByLabelText("Receipt PDFs"), [
      makePdf("receipt-1.pdf"),
      makePdf("receipt-2.pdf"),
    ])

    fireEvent.click(screen.getByRole("button", { name: /upload receipts/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.getByText("receipt-1.pdf").closest("li")?.textContent).toContain("Uploading")
    expect(screen.getByText("receipt-2.pdf").closest("li")?.textContent).toContain("Pending")

    first.resolve({
      ok: true,
      json: async () => ({ status: "added", receipt_id: "r1", total: "12.34", currency: "EUR" }),
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    second.resolve({
      ok: true,
      json: async () => ({ status: "added", receipt_id: "r2", total: "5.00", currency: "EUR" }),
    })
    await waitFor(() =>
      expect(screen.getByText("receipt-2.pdf").closest("li")?.textContent).toContain("Added"),
    )
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/pages/UploadPage.test.tsx`
Expected: FAIL on all three new tests — clicking "Upload receipts" currently does nothing (no `onClick` handler yet), so `fetch` is never called and rows stay `"Pending"`.

- [ ] **Step 3: Implement the upload loop**

Replace the full contents of `web/src/pages/UploadPage.tsx` with:

```tsx
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

type RowStatus =
  | { kind: "pending" }
  | { kind: "uploading" }
  | { kind: "added"; total: string; currency: string }
  | { kind: "duplicate" }
  | { kind: "error"; message: string }

type UploadRow = {
  file: File
  status: RowStatus
}

export function UploadPage() {
  const [rows, setRows] = useState<UploadRow[]>([])
  const [uploading, setUploading] = useState(false)

  function handleSelect(fileList: FileList | null) {
    const files = fileList ? Array.from(fileList) : []
    setRows(files.map((file) => ({ file, status: { kind: "pending" } })))
  }

  function setRowStatus(index: number, status: RowStatus) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, status } : row)))
  }

  async function uploadFile(file: File): Promise<RowStatus> {
    const body = new FormData()
    body.append("file", file)

    try {
      const res = await fetch("/api/upload", { method: "POST", body })
      const data = await res.json()
      if (!res.ok) {
        return { kind: "error", message: data.detail ?? "Upload failed." }
      }
      if (data.status === "duplicate") {
        return { kind: "duplicate" }
      }
      return { kind: "added", total: data.total, currency: data.currency }
    } catch {
      return { kind: "error", message: "Could not reach the server." }
    }
  }

  async function handleUpload() {
    setUploading(true)
    // Sequential, not Promise.all: a self-hosted/NAS server (CONTEXT.md's
    // Web Upload) shouldn't take N concurrent parse_pdf + full-store
    // export_web_data calls from one batch. Continuing past a failed file
    // (rather than aborting) matches watch.py's scan_once.
    for (let i = 0; i < rows.length; i++) {
      setRowStatus(i, { kind: "uploading" })
      const status = await uploadFile(rows[i].file)
      setRowStatus(i, status)
    }
    setUploading(false)
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <input
          type="file"
          accept="application/pdf"
          multiple
          aria-label="Receipt PDFs"
          disabled={uploading}
          onChange={(e) => handleSelect(e.target.files)}
        />
        <Button onClick={handleUpload} disabled={rows.length === 0 || uploading}>
          {uploading ? "Uploading..." : "Upload receipts"}
        </Button>
        {rows.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {rows.map((row, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span className="truncate">{row.file.name}</span>
                <RowStatusLabel status={row.status} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function RowStatusLabel({ status }: { status: RowStatus }) {
  switch (status.kind) {
    case "pending":
      return <span className="text-muted-foreground">Pending</span>
    case "uploading":
      return <span className="text-muted-foreground">Uploading...</span>
    case "added":
      return (
        <span className="text-muted-foreground">
          Added — {status.total} {status.currency}
        </span>
      )
    case "duplicate":
      return <span className="text-muted-foreground">Already in the store</span>
    case "error":
      return <span className="text-destructive">{status.message}</span>
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/pages/UploadPage.test.tsx`
Expected: PASS (all 4 tests: Task 1's row-rendering test plus this task's 3)

- [ ] **Step 5: Run the full frontend test suite and lint**

Run: `cd web && npm test && npm run lint`
Expected: PASS, no lint errors

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/UploadPage.tsx web/src/pages/UploadPage.test.tsx
git commit -m "feat: upload multiple receipts sequentially, one row per file"
```
