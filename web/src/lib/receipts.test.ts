import { describe, expect, it } from "vitest"
import { filterAndSortReceipts, mergeDuplicateLines, totalSaved, totalsMatch } from "@/lib/receipts"
import type { LineItem, Receipt, Store } from "@/lib/types"

const STORE: Store = { name: "Kaufland Test", street: null, city: null, postal_code: null }

function lineItem(overrides: Partial<LineItem>): LineItem {
  return {
    name: "Item",
    quantity: "1",
    unit_price: "1.00",
    total_price: "1.00",
    tax_class: "A",
    article_number: null,
    size_value: null,
    size_unit: null,
    ...overrides,
  }
}

function receipt(overrides: Partial<Receipt>): Receipt {
  return {
    receipt_id: "r1",
    purchased_at: "2026-08-14T10:00:00",
    store: STORE,
    line_items: [],
    total: "1.00",
    currency: "EUR",
    source: "test",
    source_file: null,
    pdf_available: false,
    ...overrides,
  }
}

describe("mergeDuplicateLines", () => {
  it("combines lines with the same name and unit price, summing quantity", () => {
    const merged = mergeDuplicateLines([
      lineItem({ name: "Milch", unit_price: "1.19", quantity: "1", total_price: "1.19" }),
      lineItem({ name: "Milch", unit_price: "1.19", quantity: "2", total_price: "2.38" }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].quantity).toBe("3")
    expect(merged[0].total_price).toBe("3.57")
  })

  it("passes null-unit-price lines through unmerged", () => {
    const merged = mergeDuplicateLines([
      lineItem({ name: "K Card XTRA Rabatt", unit_price: null, total_price: "-0.50" }),
      lineItem({ name: "K Card XTRA Rabatt", unit_price: null, total_price: "-0.30" }),
    ])
    expect(merged).toHaveLength(2)
  })

  it("keeps the existing article_number when the later duplicate line lacks one", () => {
    const merged = mergeDuplicateLines([
      lineItem({ name: "Milch", unit_price: "1.19", quantity: "1", total_price: "1.19", article_number: "12345" }),
      lineItem({ name: "Milch", unit_price: "1.19", quantity: "1", total_price: "1.19", article_number: null }),
    ])
    expect(merged[0].article_number).toBe("12345")
  })

  it("takes the later duplicate's article_number when the existing one is null", () => {
    const merged = mergeDuplicateLines([
      lineItem({ name: "Milch", unit_price: "1.19", quantity: "1", total_price: "1.19", article_number: null }),
      lineItem({ name: "Milch", unit_price: "1.19", quantity: "1", total_price: "1.19", article_number: "67890" }),
    ])
    expect(merged[0].article_number).toBe("67890")
  })
})

describe("totalSaved", () => {
  it("sums discount lines (no tax class, negative total)", () => {
    const saved = totalSaved([
      lineItem({ name: "K Card XTRA Rabatt", tax_class: null, total_price: "-0.50" }),
      lineItem({ name: "Mengenrabatt", tax_class: null, total_price: "-0.30" }),
    ])
    expect(saved).toBeCloseTo(0.8)
  })

  it("excludes Pfand/Leergut refunds, which carry a tax class", () => {
    const saved = totalSaved([
      lineItem({ name: "K Card XTRA Rabatt", tax_class: null, total_price: "-0.50" }),
      lineItem({ name: "Leergut", tax_class: "A", total_price: "-0.25" }),
    ])
    expect(saved).toBeCloseTo(0.5)
  })
})

describe("totalsMatch", () => {
  it("is true when the line items sum to the printed total", () => {
    const r = receipt({
      total: "3.57",
      line_items: [lineItem({ total_price: "1.19" }), lineItem({ total_price: "2.38" })],
    })
    expect(totalsMatch(r)).toBe(true)
  })

  it("is true just inside the 0.005 tolerance", () => {
    const r = receipt({ total: "1.00", line_items: [lineItem({ total_price: "1.0049" })] })
    expect(totalsMatch(r)).toBe(true)
  })

  it("is false clearly beyond the 0.005 tolerance", () => {
    const r = receipt({ total: "1.00", line_items: [lineItem({ total_price: "1.006" })] })
    expect(totalsMatch(r)).toBe(false)
  })
})

describe("filterAndSortReceipts", () => {
  const receiptsList: Receipt[] = [
    receipt({
      receipt_id: "kaufland-1-1-20260601-100",
      purchased_at: "2026-06-01T09:00:00",
      store: { ...STORE, name: "Kaufland Teststadt" },
      total: "10.00",
      line_items: [lineItem({}), lineItem({})],
    }),
    receipt({
      receipt_id: "kaufland-2-1-20260815-200",
      purchased_at: "2026-08-15T09:00:00",
      store: { ...STORE, name: "Kaufland Zweitstadt" },
      total: "30.00",
      line_items: [lineItem({})],
    }),
    receipt({
      receipt_id: "kaufland-1-1-20260701-300",
      purchased_at: "2026-07-01T09:00:00",
      store: { ...STORE, name: "Kaufland Teststadt" },
      total: "20.00",
      line_items: [lineItem({}), lineItem({}), lineItem({})],
    }),
  ]

  it("with no query, keeps every receipt", () => {
    expect(filterAndSortReceipts(receiptsList, "", "date", "desc")).toHaveLength(3)
  })

  it("filters by store name, case-insensitively", () => {
    const rows = filterAndSortReceipts(receiptsList, "zweitstadt", "date", "desc")
    expect(rows.map((r) => r.receipt_id)).toEqual(["kaufland-2-1-20260815-200"])
  })

  it("filters by receipt id substring", () => {
    const rows = filterAndSortReceipts(receiptsList, "20260701", "date", "desc")
    expect(rows.map((r) => r.receipt_id)).toEqual(["kaufland-1-1-20260701-300"])
  })

  it("filters by formatted date", () => {
    const rows = filterAndSortReceipts(receiptsList, "1 Jun 2026", "date", "desc")
    expect(rows.map((r) => r.receipt_id)).toEqual(["kaufland-1-1-20260601-100"])
  })

  it("sorts by date", () => {
    const asc = filterAndSortReceipts(receiptsList, "", "date", "asc")
    expect(asc.map((r) => r.receipt_id)).toEqual([
      "kaufland-1-1-20260601-100",
      "kaufland-1-1-20260701-300",
      "kaufland-2-1-20260815-200",
    ])
  })

  it("sorts by store name", () => {
    const asc = filterAndSortReceipts(receiptsList, "", "store", "asc")
    expect(asc.map((r) => r.store.name)).toEqual(["Kaufland Teststadt", "Kaufland Teststadt", "Kaufland Zweitstadt"])
  })

  it("sorts by item count", () => {
    const asc = filterAndSortReceipts(receiptsList, "", "items", "asc")
    expect(asc.map((r) => r.line_items.length)).toEqual([1, 2, 3])
  })

  it("sorts by total, descending", () => {
    const desc = filterAndSortReceipts(receiptsList, "", "total", "desc")
    expect(desc.map((r) => r.total)).toEqual(["30.00", "20.00", "10.00"])
  })
})
