import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { fmtDateObj, fmtMonth, fmtMonthShort } from "@/lib/format"
import { fmtMoney, monthlyTotals, trailingSpend } from "@/lib/receipts"

const WINDOWS = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 6 months", days: 182 },
  { label: "Last 12 months", days: 365 },
]

const CHART_CONFIG = {
  total: { label: "Spent", color: "var(--primary)" },
} satisfies ChartConfig

export function StatsPage() {
  const months = monthlyTotals()
  const grandCount = months.reduce((sum, m) => sum + m.count, 0)
  const grandTotal = months.reduce((sum, m) => sum + m.total, 0)
  const now = new Date()
  const chartData = [...months].sort((a, b) => a.month.localeCompare(b.month))

  return (
    <>
      <h1 className="text-2xl font-bold">Statistics</h1>
      <p className="mb-6 text-muted-foreground">Trailing spend as of {fmtDateObj(now)}</p>

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

      {chartData.length > 0 && (
        <>
          <h2 className="mb-3 text-lg font-semibold">Monthly spend</h2>
          <Card className="mb-8">
            <CardContent>
              <ChartContainer config={CHART_CONFIG} className="aspect-auto h-[240px] w-full">
                <BarChart data={chartData}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={fmtMonthShort} />
                  <ChartTooltip
                    content={<ChartTooltipContent labelFormatter={(value) => fmtMonth(String(value))} formatter={(value) => fmtMoney(Number(value))} />}
                  />
                  <Bar dataKey="total" fill="var(--color-total)" radius={4} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </>
      )}

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
                <TableCell>{fmtMonth(m.month)}</TableCell>
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
