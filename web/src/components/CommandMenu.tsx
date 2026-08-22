import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Search } from "lucide-react"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { fmtDateTime } from "@/lib/format"
import { fmtMoney, itemPriceHistory, num, receipts, slugify } from "@/lib/receipts"

/** Global Cmd+K / Ctrl+K quick-jump to any receipt, item, or page. */
export function CommandMenu() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  function go(path: string) {
    setOpen(false)
    navigate(path)
  }

  const sortedReceipts = [...receipts].sort((a, b) => b.purchased_at.localeCompare(a.purchased_at))
  const itemNames = Array.from(itemPriceHistory().keys()).sort((a, b) => a.localeCompare(b))

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-border bg-secondary/60 px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Search...</span>
        <kbd className="ml-2 hidden rounded border border-border bg-background px-1.5 py-0.5 text-[0.7rem] sm:inline">&#8984;K</kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Quick jump" description="Jump to a receipt, item, or page">
        <Command>
          <CommandInput placeholder="Search receipts, items, pages..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Pages">
              <CommandItem value="receipts page" onSelect={() => go("/")}>
                Receipts
              </CommandItem>
              <CommandItem value="statistics page" onSelect={() => go("/stats")}>
                Statistics
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Receipts">
              {sortedReceipts.map((r) => (
                <CommandItem
                  key={r.receipt_id}
                  value={`${r.receipt_id} ${r.store.name} ${fmtDateTime(r.purchased_at)}`}
                  onSelect={() => go(`/receipts/${r.receipt_id}`)}
                >
                  {fmtDateTime(r.purchased_at)} &middot; {r.store.name} &middot; {fmtMoney(num(r.total), r.currency)}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Items">
              {itemNames.map((name) => (
                <CommandItem key={name} value={name} onSelect={() => go(`/items/${slugify(name)}`)}>
                  {name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
