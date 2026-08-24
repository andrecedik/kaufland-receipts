import { Link, useParams } from "react-router-dom"
import { Sparkline } from "@/components/Sparkline"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { fmtDate, isoDate } from "@/lib/format"
import { itemNameForSlug, itemPriceHistory, num } from "@/lib/receipts"

export function ItemPage() {
  const { slug } = useParams<{ slug: string }>()
  const byName = itemPriceHistory()
  const name = slug ? itemNameForSlug(slug) : undefined
  const observations = name ? byName.get(name) : undefined

  if (!name || !observations) {
    return (
      <>
        <Button asChild variant="outline" size="sm" className="mb-4">
          <Link to="/">&larr; All receipts</Link>
        </Button>
        <p>No price history for this item.</p>
      </>
    )
  }

  // Chart data keeps a plain ISO date (sortable/parseable); display strings
  // are formatted separately below.
  const points = observations.map((o) => ({
    date: isoDate(o.receipt.purchased_at),
    price: num(o.lineItem.unit_price),
  }))
  const first = points[0]
  const last = points[points.length - 1]
  const changed = points.length > 1 && first.price !== last.price
  const delta = last.price - first.price
  const pct = first.price ? (delta / first.price) * 100 : 0

  return (
    <>
      <Button asChild variant="outline" size="sm" className="mb-4">
        <Link to="/">&larr; All receipts</Link>
      </Button>
      <h1 className="text-2xl font-bold">{name}</h1>
      <p className="mb-1 text-muted-foreground">{points.length} observation(s)</p>
      {changed && (
        <p className="mb-4 text-muted-foreground">
          {delta > 0 ? "up" : "down"} from {first.price.toFixed(2)} to {last.price.toFixed(2)} EUR ({pct >= 0 ? "+" : ""}
          {pct.toFixed(1)}%) between {fmtDate(first.date)} and {fmtDate(last.date)}
        </p>
      )}

      <div className="my-4 mb-8">
        <Sparkline points={points} />
      </div>

      <div className="overflow-hidden rounded-[10px]">
        <Table>
          <TableHeader className="bg-thead [&_tr]:border-b-0">
            <TableRow className="hover:bg-thead">
              <TableHead className="text-thead-foreground">Date</TableHead>
              <TableHead className="text-thead-foreground">Receipt</TableHead>
              <TableHead className="text-right text-thead-foreground">Unit price</TableHead>
              <TableHead className="text-right text-thead-foreground">Qty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...observations].reverse().map((o, i) => (
              <TableRow key={o.receipt.receipt_id + i} className={i % 2 === 1 ? "bg-muted/60" : ""}>
                <TableCell>{fmtDate(o.receipt.purchased_at)}</TableCell>
                <TableCell>
                  <Link to={`/receipts/${o.receipt.receipt_id}`} className="text-primary hover:underline">
                    {o.receipt.receipt_id}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{num(o.lineItem.unit_price).toFixed(2)} EUR</TableCell>
                <TableCell className="text-right tabular-nums">{o.lineItem.quantity}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
