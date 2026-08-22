import { Link, useParams } from "react-router-dom"
import { Sparkline } from "@/components/Sparkline"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { fmtDate } from "@/lib/format"
import { itemPriceHistory, num, slugify } from "@/lib/receipts"

export function ItemPage() {
  const { slug } = useParams<{ slug: string }>()
  const byName = itemPriceHistory()
  const entry = Array.from(byName.entries()).find(([name]) => slugify(name) === slug)

  if (!entry) {
    return (
      <>
        <Link to="/" className="mb-4 inline-block text-primary hover:underline">
          &larr; All receipts
        </Link>
        <p>No price history for this item.</p>
      </>
    )
  }

  const [name, observations] = entry
  const points = observations.map((o) => ({
    date: fmtDate(o.receipt.purchased_at),
    price: num(o.lineItem.unit_price),
  }))
  const first = points[0]
  const last = points[points.length - 1]
  const changed = points.length > 1 && first.price !== last.price
  const delta = last.price - first.price
  const pct = first.price ? (delta / first.price) * 100 : 0

  return (
    <>
      <Link to="/" className="mb-4 inline-block text-primary hover:underline">
        &larr; All receipts
      </Link>
      <h1 className="text-2xl font-bold">{name}</h1>
      <p className="mb-1 text-muted-foreground">{points.length} observation(s)</p>
      {changed && (
        <p className="mb-4 text-muted-foreground">
          {delta > 0 ? "up" : "down"} from {first.price.toFixed(2)} to {last.price.toFixed(2)} EUR ({pct >= 0 ? "+" : ""}
          {pct.toFixed(1)}%) between {first.date} and {last.date}
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
