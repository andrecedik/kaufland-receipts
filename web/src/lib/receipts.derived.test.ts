import { describe, expect, it } from "vitest"
import { itemPriceHistory, monthlyTotals, receipts, trailingSpend } from "@/lib/receipts"
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

// `receipts` is normally populated by loadReceipts() (a runtime fetch, see
// main.tsx) before the app renders; here it's filled directly with fixture
// data instead, since these tests exercise functions that read it.
receipts.push(
  receipt({
    receipt_id: "a",
    purchased_at: "2026-06-01T09:00:00",
    total: "2.00",
    line_items: [lineItem({ name: "Milch", unit_price: "2.00", total_price: "2.00" })],
  }),
  receipt({
    receipt_id: "b",
    purchased_at: "2026-06-15T09:00:00",
    total: "-0.50",
    line_items: [lineItem({ name: "Leergut", unit_price: null, tax_class: "A", total_price: "-0.50" })],
  }),
  receipt({
    receipt_id: "c",
    purchased_at: "2026-08-01T09:00:00",
    total: "2.19",
    line_items: [lineItem({ name: "Milch", unit_price: "2.19", total_price: "2.19" })],
  }),
)

describe("derived stats over the receipt collection", () => {
  it("itemPriceHistory sorts observations by purchase date and skips refunds/no-price lines", () => {
    const history = itemPriceHistory()
    expect(Array.from(history.keys())).toEqual(["Milch"])
    const milch = history.get("Milch")!
    expect(milch.map((o) => o.receipt.receipt_id)).toEqual(["a", "c"])
  })

  it("monthlyTotals groups by month, newest first", () => {
    expect(monthlyTotals()).toEqual([
      { month: "2026-08", count: 1, total: 2.19 },
      { month: "2026-06", count: 2, total: 1.5 },
    ])
  })

  it("trailingSpend sums receipts within the window relative to `now`", () => {
    const now = new Date("2026-08-10T00:00:00")
    expect(trailingSpend(30, now)).toEqual({ total: 2.19, count: 1 })
    expect(trailingSpend(120, now)).toEqual({ total: 3.69, count: 3 })
  })
})
