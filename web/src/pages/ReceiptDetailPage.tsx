import { Info, TriangleAlert } from "lucide-react"
import { Link, useParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { fmtDateTime } from "@/lib/format"
import { fmtMoney, formatVerdict, itemSlug, lineItemSum, mergeDuplicateLines, num, receipts, totalSaved, totalsMatch } from "@/lib/receipts"

export function ReceiptDetailPage() {
  const { id } = useParams<{ id: string }>()
  const receipt = receipts.find((r) => r.receipt_id === id)

  if (!receipt) {
    return (
      <>
        <Button asChild variant="outline" size="sm" className="mb-4">
          <Link to="/">&larr; All receipts</Link>
        </Button>
        <p>Receipt not found.</p>
      </>
    )
  }

  const merged = mergeDuplicateLines(receipt.line_items)
  const saved = totalSaved(receipt.line_items)
  const matches = totalsMatch(receipt)
  const address = [receipt.store.street, `${receipt.store.postal_code ?? ""} ${receipt.store.city ?? ""}`.trim()]
    .filter(Boolean)
    .join(", ")

  return (
    <>
      <Button asChild variant="outline" size="sm" className="mb-4">
        <Link to="/">&larr; All receipts</Link>
      </Button>
      <h1 className="text-2xl font-bold">{receipt.store.name}</h1>
      <p className="mb-2 text-muted-foreground">
        {fmtDateTime(receipt.purchased_at)}
        {address ? ` · ${address}` : ""}
      </p>
      <div className="mb-4 flex items-center gap-2">
        <Drawer direction="right">
          <DrawerTrigger asChild>
            <Button type="button" variant={matches ? "outline" : "destructive"} size="sm">
              {matches ? <Info /> : <TriangleAlert />}
              View Info
            </Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Receipt info</DrawerTitle>
              <DrawerDescription>Ingestion metadata — not part of the printed receipt.</DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-col gap-3 px-4 pb-4 text-sm">
              <div>
                <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Receipt ID</div>
                <div className="font-mono">{receipt.receipt_id}</div>
              </div>
              <div>
                <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Source</div>
                <div>{receipt.source}</div>
              </div>
              <div>
                <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Parsing</div>
                {matches ? (
                  <p className="text-match">&#10003; matches printed total</p>
                ) : (
                  <p className="font-semibold text-destructive">
                    &#9888; line items sum to {lineItemSum(receipt).toFixed(2)}, printed total is {num(receipt.total).toFixed(2)}
                  </p>
                )}
              </div>
            </div>
            <DrawerFooter>
              <DrawerClose asChild>
                <Button type="button" variant="outline">
                  Close
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
        {receipt.pdf_available && (
          <Button asChild variant="outline" size="sm">
            <a href={`pdfs/${receipt.receipt_id}.pdf`}>View original PDF</a>
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-[10px]">
        <Table>
          <TableHeader className="bg-thead [&_tr]:border-b-0">
            <TableRow className="hover:bg-thead">
              <TableHead className="text-thead-foreground">Item</TableHead>
              <TableHead className="text-right text-thead-foreground">Qty</TableHead>
              <TableHead className="text-right text-thead-foreground">Unit</TableHead>
              <TableHead className="text-right text-thead-foreground">Total</TableHead>
              <TableHead className="text-thead-foreground">Tax</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {merged.map((li, i) => (
              <TableRow key={li.name + li.unit_price + i} className={i % 2 === 1 ? "bg-muted/60" : ""}>
                <TableCell>
                  <Link to={`/items/${itemSlug(li.name)}`} className="text-primary hover:underline">
                    {li.name}
                  </Link>
                  {li.size_value !== null && (
                    <Badge variant="secondary" className="ml-2">
                      {Number(li.size_value)} {li.size_unit}
                    </Badge>
                  )}
                  {li.price_verdict && (
                    <Badge variant={li.price_verdict.label === "genuine" ? "default" : "secondary"} className="ml-2">
                      {formatVerdict(li.price_verdict)}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{li.quantity}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {li.unit_price !== null ? `${num(li.unit_price).toFixed(2)} EUR` : "–"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{num(li.total_price).toFixed(2)} EUR</TableCell>
                <TableCell>
                  <Badge variant="secondary">{li.tax_class ?? "?"}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-bold">
                Total saved
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">{fmtMoney(saved, receipt.currency)}</TableCell>
              <TableCell />
            </TableRow>
            <TableRow>
              <TableCell colSpan={3} className="font-bold">
                Total
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">{fmtMoney(num(receipt.total), receipt.currency)}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </>
  )
}
