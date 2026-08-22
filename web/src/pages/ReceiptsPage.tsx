import { useState } from "react"
import { Link } from "react-router-dom"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { fmtDateTime } from "@/lib/format"
import { filterAndSortReceipts, fmtMoney, num, receipts, totalSaved, type ReceiptSortKey } from "@/lib/receipts"

const COLUMNS: { key: ReceiptSortKey; label: string; align?: "right" }[] = [
  { key: "date", label: "Date" },
  { key: "store", label: "Store" },
  { key: "items", label: "Items", align: "right" },
  { key: "total", label: "Total", align: "right" },
]

export function ReceiptsPage() {
  const [query, setQuery] = useState("")
  const [sortKey, setSortKey] = useState<ReceiptSortKey>("date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const grandTotal = receipts.reduce((sum, r) => sum + num(r.total), 0)
  const grandSaved = receipts.reduce((sum, r) => sum + totalSaved(r.line_items), 0)
  const rows = filterAndSortReceipts(receipts, query, sortKey, sortDir)

  function toggleSort(key: ReceiptSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir(key === "date" ? "desc" : "asc")
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold">Kaufland Receipts</h1>
      <p className="mb-6 text-muted-foreground">{receipts.length} receipt(s)</p>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent>
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Total saved</div>
            <div className="text-2xl font-bold">{fmtMoney(grandSaved)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Total spent</div>
            <div className="text-2xl font-bold">{fmtMoney(grandTotal)}</div>
          </CardContent>
        </Card>
      </div>

      <Input
        placeholder="Filter by store, date, or receipt id..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-4 max-w-sm"
      />

      <div className="overflow-hidden rounded-[10px]">
        <Table>
          <TableHeader className="bg-thead [&_tr]:border-b-0">
            <TableRow className="hover:bg-thead">
              {COLUMNS.map((col) => (
                <TableHead
                  key={col.key}
                  className={col.align === "right" ? "text-right text-thead-foreground" : "text-thead-foreground"}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className={`inline-flex items-center gap-1 hover:text-thead-foreground/80 ${col.align === "right" ? "flex-row-reverse" : ""}`}
                  >
                    {col.label}
                    {sortKey === col.key ? (
                      sortDir === "asc" ? (
                        <ArrowUp className="size-3.5" />
                      ) : (
                        <ArrowDown className="size-3.5" />
                      )
                    ) : (
                      <ArrowUpDown className="size-3.5 opacity-40" />
                    )}
                  </button>
                </TableHead>
              ))}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>{receipts.length === 0 ? "No receipts yet." : "No receipts match your search."}</TableCell>
              </TableRow>
            )}
            {rows.map((r, i) => (
              <TableRow key={r.receipt_id} className={i % 2 === 1 ? "bg-muted/60" : ""}>
                <TableCell>{fmtDateTime(r.purchased_at)}</TableCell>
                <TableCell>{r.store.name}</TableCell>
                <TableCell className="text-right tabular-nums">{r.line_items.length}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(num(r.total), r.currency)}</TableCell>
                <TableCell>
                  <Link to={`/receipts/${r.receipt_id}`} className="font-medium text-primary hover:underline">
                    Details
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
