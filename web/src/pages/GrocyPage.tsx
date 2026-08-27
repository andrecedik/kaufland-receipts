import { Copy } from "lucide-react"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
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
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !query) {
      setResults([])
      return
    }
    let cancelled = false
    const timeout = setTimeout(() => {
      searchGrocyProducts(query).then((r) => {
        if (!cancelled) setResults(r)
      })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [open, query])

  async function pick(product: GrocyProduct) {
    try {
      setError(null)
      await resolveMapping({ raw_name: rawName, grocy_product_id: product.id })
      setOpen(false)
      onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve the mapping.")
    }
  }

  async function createNew() {
    if (!query) return
    try {
      setError(null)
      await resolveMapping({ raw_name: rawName, new_product_name: query })
      setOpen(false)
      onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve the mapping.")
    }
  }

  async function skip() {
    try {
      setError(null)
      await resolveMapping({ raw_name: rawName, skipped: true })
      onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve the mapping.")
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span>{rawName}</span>
        {open ? (
          <>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Use "${rawName}" as the search text`}
              onClick={() => setQuery(rawName)}
            >
              <Copy />
            </Button>
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
                <CommandEmpty className="px-2 py-1.5 text-sm text-muted-foreground">No matches.</CommandEmpty>
                <CommandGroup>
                  {results.map((p) => (
                    <CommandItem key={p.id} value={p.name} onSelect={() => pick(p)}>
                      {p.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
            <Button
              size="sm"
              variant="outline"
              aria-label={`Create "${query}"`}
              disabled={!query}
              onClick={createNew}
            >
              Create
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" aria-label={`Map "${rawName}"`} onClick={() => setOpen(true)}>
            Map
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-label={`Skip "${rawName}"`} onClick={skip}>
          Skip
        </Button>
      </div>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  )
}

export function GrocyPage() {
  const [pending, setPending] = useState<GrocyPendingReceipt[]>([])
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({})

  async function reload() {
    setPending(await fetchPending())
  }

  useEffect(() => {
    reload()
  }, [])

  async function retry(receiptId: string) {
    try {
      setRetryErrors((prev) => ({ ...prev, [receiptId]: "" }))
      await retryReceiptPush(receiptId)
      reload()
    } catch (err) {
      setRetryErrors((prev) => ({
        ...prev,
        [receiptId]: err instanceof Error ? err.message : "Retry failed.",
      }))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Link to="/grocy/settings" className="self-end text-sm text-muted-foreground hover:text-foreground">
        Grocy settings
      </Link>
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
            {retryErrors[r.receipt_id] && (
              <span className="text-sm text-destructive">{retryErrors[r.receipt_id]}</span>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
