import { fmtDateTime } from "@/lib/format"
import type { LineItem, PriceVerdict, Receipt } from "@/lib/types"

// Fetched at runtime from public/data/receipts.json rather than imported as
// a JS module -- an import gets inlined straight into the main bundle, so
// the shipped chunk size would grow with every receipt ever ingested. Kept
// as a mutable array (not reassigned) so every function below that closes
// over `receipts` sees the loaded data without needing its own fetch.
export const receipts: Receipt[] = []

async function fetchReceipts(): Promise<Receipt[]> {
  const res = await fetch("data/receipts.json")
  return (await res.json()) as Receipt[]
}

export async function loadReceipts(): Promise<void> {
  receipts.push(...(await fetchReceipts()))
}

/**
 * Re-fetches data/receipts.json and replaces `receipts`' contents in place
 * (same array reference, so every function below that closed over it stays
 * valid) -- used after a Web Upload batch finishes, since `receipts` is
 * otherwise only ever loaded once, at app boot. Also drops the itemSlugs()
 * cache, which relied on `receipts` never changing until this existed.
 */
export async function refreshReceipts(): Promise<void> {
  const data = await fetchReceipts()
  receipts.length = 0
  receipts.push(...data)
  cachedItemSlugs = null
}

export function num(value: string | null): number {
  return value === null ? 0 : Number(value)
}

export function fmtMoney(value: number, currency = "EUR"): string {
  return `${value.toFixed(2)} ${currency}`
}

export function formatVerdict(v: PriceVerdict): string {
  const pct = Math.round(Math.abs(num(v.percent_delta)))
  if (v.label === "genuine") return `${pct}% below usual price`
  if (v.label === "worse_than_usual") return `${pct}% above usual price`
  return `Only ${pct}% off`
}

// Dot color for a price-verdict badge -- reuses the app's own semantic
// tokens (the same green as the "matches printed total" check) rather than
// hardcoded Tailwind colors, so it follows the active theme (e.g. Monokai).
export function verdictDotClass(label: string): string {
  if (label === "genuine") return "bg-match"
  if (label === "worse_than_usual") return "bg-destructive"
  return "bg-warning"
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "item"
}

/**
 * Combine lines with the same name and unit price into one, summing
 * quantity -- mirrors `_merge_duplicate_lines` in the Python site generator.
 * Kaufland prints a separate line each time the same article is scanned at
 * the same price rather than bumping the quantity itself.
 */
export function mergeDuplicateLines(lineItems: LineItem[]): LineItem[] {
  const merged: LineItem[] = []
  const index = new Map<string, number>()
  for (const li of lineItems) {
    if (li.unit_price === null) {
      merged.push(li)
      continue
    }
    const key = `${li.name}\0${li.unit_price}`
    const existingIdx = index.get(key)
    if (existingIdx !== undefined) {
      const existing = merged[existingIdx]
      const newQty = num(existing.quantity) + num(li.quantity)
      merged[existingIdx] = {
        ...existing,
        quantity: String(newQty),
        total_price: String(num(existing.unit_price) * newQty),
        article_number: existing.article_number ?? li.article_number,
      }
    } else {
      index.set(key, merged.length)
      merged.push(li)
    }
  }
  return merged
}

export interface DisplayLineItem extends LineItem {
  /** Sum of any attached discount lines' total_price (negative, 0 if none). */
  discountTotal: number
}

/**
 * Folds each discount line (K Card XTRA Rabatt, Mengenrabatt, Artikelrabatt,
 * ...) into the product line immediately before it, then merges same-name/
 * unit-price duplicates the same way `mergeDuplicateLines` does. Mirrors
 * `attach_item_discounts` in price_integrity.py -- discount lines are
 * recognized by having no tax_class, unlike every product/refund line, and
 * are dropped from the result once folded in. Keep in sync with the Python
 * original if the recognition rule ever changes.
 *
 * Used by the receipt detail page only -- `mergeDuplicateLines` (used
 * elsewhere, e.g. price history) intentionally still surfaces discount
 * lines as their own rows, since it has no notion of "attached to".
 */
export function withAttachedDiscounts(lineItems: LineItem[]): DisplayLineItem[] {
  const merged: DisplayLineItem[] = []
  const index = new Map<string, number>()
  let i = 0
  while (i < lineItems.length) {
    const item = lineItems[i]
    if (item.tax_class === null) {
      i++ // orphan discount line, nothing to attach to
      continue
    }
    i++
    let discountTotal = 0
    while (i < lineItems.length && lineItems[i].tax_class === null) {
      discountTotal += num(lineItems[i].total_price)
      i++
    }

    if (item.unit_price === null) {
      merged.push({ ...item, discountTotal })
      continue
    }
    const key = `${item.name}\0${item.unit_price}`
    const existingIdx = index.get(key)
    if (existingIdx !== undefined) {
      const existing = merged[existingIdx]
      const newQty = num(existing.quantity) + num(item.quantity)
      merged[existingIdx] = {
        ...existing,
        quantity: String(newQty),
        total_price: String(num(existing.unit_price) * newQty),
        article_number: existing.article_number ?? item.article_number,
        discountTotal: existing.discountTotal + discountTotal,
      }
    } else {
      index.set(key, merged.length)
      merged.push({ ...item, discountTotal })
    }
  }
  return merged
}

/** Effective price per unit once the attached discount is folded in.
 * Mirrors `_effective_unit_price` in price_integrity.py. */
export function effectiveUnitPrice(item: LineItem, discountTotal: number): number {
  return (num(item.total_price) + discountTotal) / num(item.quantity)
}

/**
 * Sum of discount lines (K Card XTRA Rabatt, Mengenrabatt, Artikelrabatt,
 * ...): negative line items with no tax class. Pfand/Leergut refunds are
 * also negative but always carry a tax class and are deposit money back,
 * not a saving -- mirrors `_total_saved` in the Python site generator.
 */
export function totalSaved(receipt: Receipt): number {
  const lineDiscounts = -receipt.line_items
    .filter((li) => li.tax_class === null && num(li.total_price) < 0)
    .reduce((sum, li) => sum + num(li.total_price), 0)
  const coupon = -num(receipt.threshold_coupon_discount)
  return lineDiscounts + coupon
}

export function lineItemSum(receipt: Receipt): number {
  return (
    receipt.line_items.reduce((sum, li) => sum + num(li.total_price), 0) +
    num(receipt.threshold_coupon_discount)
  )
}

export function totalsMatch(receipt: Receipt): boolean {
  // Same cent-rounding tolerance concern as floats generally; receipts are
  // small enough in magnitude that this is safe for a read-only display.
  return Math.abs(lineItemSum(receipt) - num(receipt.total)) < 0.005
}

export type ReceiptSortKey = "date" | "store" | "items" | "total"

/** Powers ReceiptsPage's search box + sortable column headers: a
 * case-insensitive substring match against store name, receipt id, or
 * formatted date, then a sort by the requested column/direction. */
export function filterAndSortReceipts(
  allReceipts: Receipt[],
  query: string,
  sortKey: ReceiptSortKey,
  sortDir: "asc" | "desc",
): Receipt[] {
  const q = query.trim().toLowerCase()
  const filtered = q
    ? allReceipts.filter(
        (r) =>
          r.store.name.toLowerCase().includes(q) ||
          r.receipt_id.toLowerCase().includes(q) ||
          fmtDateTime(r.purchased_at).toLowerCase().includes(q),
      )
    : allReceipts

  const dir = sortDir === "asc" ? 1 : -1
  return [...filtered].sort((a, b) => {
    switch (sortKey) {
      case "date":
        return dir * a.purchased_at.localeCompare(b.purchased_at)
      case "store":
        return dir * a.store.name.localeCompare(b.store.name)
      case "items":
        return dir * (a.line_items.length - b.line_items.length)
      case "total":
        return dir * (num(a.total) - num(b.total))
    }
  })
}

export interface ItemObservation {
  receipt: Receipt
  lineItem: LineItem
}

export function itemPriceHistory(): Map<string, ItemObservation[]> {
  const byName = new Map<string, ItemObservation[]>()
  for (const r of receipts) {
    for (const li of mergeDuplicateLines(r.line_items)) {
      if (li.unit_price === null || num(li.total_price) < 0) continue
      const list = byName.get(li.name) ?? []
      list.push({ receipt: r, lineItem: li })
      byName.set(li.name, list)
    }
  }
  for (const list of byName.values()) {
    list.sort((a, b) => a.receipt.purchased_at.localeCompare(b.receipt.purchased_at))
  }
  return byName
}

let cachedItemSlugs: Map<string, string> | null = null

/**
 * Deterministic name -> URL slug map for item pages, built once over every
 * name in itemPriceHistory(). Plain slugify() can collide (e.g. two names
 * differing only by punctuation or an umlaut); this appends -2, -3, ... to
 * any name whose base slug is already taken, so distinct items never share
 * a route. `receipts` only changes via loadReceipts() at boot or
 * refreshReceipts() after a Web Upload batch -- both invalidate this cache
 * (the latter explicitly resets cachedItemSlugs), so memoizing here is safe.
 */
export function itemSlugs(): Map<string, string> {
  if (cachedItemSlugs) return cachedItemSlugs
  const names = Array.from(itemPriceHistory().keys()).sort((a, b) => a.localeCompare(b))
  const map = new Map<string, string>()
  const used = new Set<string>()
  for (const name of names) {
    let slug = slugify(name)
    if (used.has(slug)) {
      let n = 2
      while (used.has(`${slug}-${n}`)) n++
      slug = `${slug}-${n}`
    }
    used.add(slug)
    map.set(name, slug)
  }
  cachedItemSlugs = map
  return map
}

/** Slug for an item link. Falls back to plain slugify() for a name with no
 * price-history entry (e.g. a refund/discount-only line) -- that slug won't
 * resolve via itemNameForSlug either, matching today's "no price history
 * for this item" behavior rather than producing a literal "undefined". */
export function itemSlug(name: string): string {
  return itemSlugs().get(name) ?? slugify(name)
}

export function itemNameForSlug(slug: string): string | undefined {
  for (const [name, s] of itemSlugs()) {
    if (s === slug) return name
  }
  return undefined
}

export function monthlyTotals(): { month: string; count: number; total: number }[] {
  const byMonth = new Map<string, { count: number; total: number }>()
  for (const r of receipts) {
    const month = r.purchased_at.slice(0, 7)
    const entry = byMonth.get(month) ?? { count: 0, total: 0 }
    entry.count += 1
    entry.total += num(r.total)
    byMonth.set(month, entry)
  }
  return Array.from(byMonth.entries())
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => b.month.localeCompare(a.month))
}

export function trailingSpend(days: number, now = new Date()): { total: number; count: number } {
  const cutoff = new Date(now.getTime() - days * 86400_000)
  const inWindow = receipts.filter((r) => new Date(r.purchased_at) >= cutoff)
  return {
    total: inWindow.reduce((sum, r) => sum + num(r.total), 0),
    count: inWindow.length,
  }
}
