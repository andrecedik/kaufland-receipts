import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { fmtMoney, monthlyTotals, trailingSpend } from "@/lib/receipts"

const WINDOWS = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 6 months", days: 182 },
  { label: "Last 12 months", days: 365 },
]

export function StatsPage() {
  const months = monthlyTotals()
  const grandCount = months.reduce((sum, m) => sum + m.count, 0)
  const grandTotal = months.reduce((sum, m) => sum + m.total, 0)
  const now = new Date()

  return (
    <>
      <h1 className="text-2xl font-bold">Statistics</h1>
      <p className="mb-6 text-muted-foreground">Trailing spend as of {now.toISOString().slice(0, 10)}</p>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {WINDOWS.map((w) => {
          const { total, count } = trailingSpend(w.days, now)
          return (
            <Card key={w.label}>
              <CardContent>
                <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{w.label}</div>
                <div className="text-2xl font-bold">{fmtMoney(total)}</div>
                <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{count} receipt(s)</div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <h2 className="mb-3 text-lg font-semibold">Monthly totals</h2>
      <div className="overflow-hidden rounded-[10px]">
        <Table>
          <TableHeader className="bg-thead [&_tr]:border-b-0">
            <TableRow className="hover:bg-thead">
              <TableHead className="text-thead-foreground">Month</TableHead>
              <TableHead className="text-right text-thead-foreground">Receipts</TableHead>
              <TableHead className="text-right text-thead-foreground">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.length === 0 && (
              <TableRow>
                <TableCell colSpan={3}>No receipts yet.</TableCell>
              </TableRow>
            )}
            {months.map((m, i) => (
              <TableRow key={m.month} className={i % 2 === 1 ? "bg-muted/60" : ""}>
                <TableCell>{m.month}</TableCell>
                <TableCell className="text-right tabular-nums">{m.count}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(m.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-bold">Total</TableCell>
              <TableCell className="text-right font-bold tabular-nums">{grandCount}</TableCell>
              <TableCell className="text-right font-bold tabular-nums">{fmtMoney(grandTotal)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </>
  )
}
