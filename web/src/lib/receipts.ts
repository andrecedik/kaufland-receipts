import receiptsData from "@/data/receipts.json"
import type { LineItem, Receipt } from "@/lib/types"

export const receipts: Receipt[] = receiptsData as Receipt[]

export function num(value: string | null): number {
  return value === null ? 0 : Number(value)
}

export function fmtMoney(value: number, currency = "EUR"): string {
  return `${value.toFixed(2)} ${currency}`
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

/**
 * Sum of discount lines (K Card XTRA Rabatt, Mengenrabatt, Artikelrabatt,
 * ...): negative line items with no tax class. Pfand/Leergut refunds are
 * also negative but always carry a tax class and are deposit money back,
 * not a saving -- mirrors `_total_saved` in the Python site generator.
 */
export function totalSaved(lineItems: LineItem[]): number {
  return -lineItems
    .filter((li) => li.tax_class === null && num(li.total_price) < 0)
    .reduce((sum, li) => sum + num(li.total_price), 0)
}

export function lineItemSum(receipt: Receipt): number {
  return receipt.line_items.reduce((sum, li) => sum + num(li.total_price), 0)
}

export function totalsMatch(receipt: Receipt): boolean {
  // Same cent-rounding tolerance concern as floats generally; receipts are
  // small enough in magnitude that this is safe for a read-only display.
  return Math.abs(lineItemSum(receipt) - num(receipt.total)) < 0.005
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
 * a route. `receipts` is static import data, so this is safe to cache.
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
