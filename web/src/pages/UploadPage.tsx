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
