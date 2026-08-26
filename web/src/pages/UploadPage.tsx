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
