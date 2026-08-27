import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { fetchPending, resolveMapping, retryReceiptPush, searchGrocyProducts } from "@/lib/grocy"
import type { GrocyPendingReceipt, GrocyProduct } from "@/lib/types"

function ItemPicker({
  rawName,
  onResolved,
}: {
  rawName: string
  onResolved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<GrocyProduct[]>([])

  useEffect(() => {
    if (!open || !query) {
      setResults([])
      return
    }
    let cancelled = false
    searchGrocyProducts(query).then((r) => {
      if (!cancelled) setResults(r)
    })
    return () => {
      cancelled = true
    }
  }, [open, query])

  async function pick(product: GrocyProduct) {
    await resolveMapping({ raw_name: rawName, grocy_product_id: product.id })
    setOpen(false)
    onResolved()
  }

  async function createNew() {
    if (!query) return
    await resolveMapping({ raw_name: rawName, new_product_name: query })
    setOpen(false)
    onResolved()
  }

  async function skip() {
    await resolveMapping({ raw_name: rawName, skipped: true })
    onResolved()
  }

  return (
    <div className="flex items-center gap-2">
      <span>{rawName}</span>
      {open ? (
        <Command className="w-72 rounded border border-border">
          <CommandInput
            placeholder="Search Grocy products..."
            value={query}
            onValueChange={setQuery}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results.length === 0) createNew()
            }}
          />
          <CommandList>
            <CommandEmpty>
              <button type="button" className="w-full px-2 py-1 text-left text-sm" onClick={createNew}>
                Create "{query}"
              </button>
            </CommandEmpty>
            <CommandGroup>
              {results.map((p) => (
                <CommandItem key={p.id} value={p.name} onSelect={() => pick(p)}>
                  {p.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      ) : (
        <Button size="sm" variant="secondary" aria-label={`Map "${rawName}"`} onClick={() => setOpen(true)}>
          Map
        </Button>
      )}
      <Button size="sm" variant="ghost" aria-label={`Skip "${rawName}"`} onClick={skip}>
        Skip
      </Button>
    </div>
  )
}

export function GrocyPage() {
  const [pending, setPending] = useState<GrocyPendingReceipt[]>([])

  async function reload() {
    setPending(await fetchPending())
  }

  useEffect(() => {
    reload()
  }, [])

  async function retry(receiptId: string) {
    await retryReceiptPush(receiptId)
    reload()
  }

  return (
    <div className="flex flex-col gap-4">
      {pending.length === 0 && <p className="text-sm text-muted-foreground">Nothing pending.</p>}
      {pending.map((r) => (
        <Card key={r.receipt_id}>
          <CardHeader>
            <CardTitle>
              {r.store_name} &middot; {r.total} {r.currency}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {r.unresolved.map((item) => (
              <ItemPicker key={item.index} rawName={item.name} onResolved={reload} />
            ))}
            {r.failed.map((item) => (
              <div key={item.index} className="flex items-center gap-2">
                <span>{item.name}</span>
                <Badge variant="destructive">{item.error}</Badge>
                <Button size="sm" variant="secondary" onClick={() => retry(r.receipt_id)}>
                  Retry
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
