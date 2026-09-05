import { describe, expect, it } from "vitest"
import { effectiveUnitPrice, withAttachedDiscounts } from "@/lib/receipts"
import type { LineItem } from "@/lib/types"

function product(overrides: Partial<LineItem> = {}): LineItem {
  return {
    name: "A",
    quantity: "1",
    unit_price: "2.00",
    total_price: "2.00",
    tax_class: "B",
    article_number: null,
    size_value: null,
    size_unit: null,
    ...overrides,
  }
}

function discount(name = "K Card XTRA Rabatt", total_price = "-0.50"): LineItem {
  return {
    name,
    quantity: "1",
    unit_price: null,
    total_price,
    tax_class: null,
    article_number: null,
    size_value: null,
    size_unit: null,
  }
}

describe("withAttachedDiscounts", () => {
  it("attaches a following discount line to the preceding product and drops the discount row", () => {
    const a = product({ name: "A", total_price: "2.00" })
    const b = product({ name: "B", total_price: "1.00", unit_price: "1.00" })
    const result = withAttachedDiscounts([a, discount("K Card XTRA Rabatt", "-0.50"), b])

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ name: "A", discountTotal: -0.5 })
    expect(result[1]).toMatchObject({ name: "B", discountTotal: 0 })
  })

  it("sums consecutive discount lines onto one item", () => {
    const a = product({ total_price: "2.00" })
    const result = withAttachedDiscounts([a, discount("Mengenrabatt", "-0.20"), discount("K Card XTRA Rabatt", "-0.30")])

    expect(result).toHaveLength(1)
    expect(result[0].discountTotal).toBeCloseTo(-0.5)
  })

  it("drops an orphan discount line with nothing to attach to", () => {
    const result = withAttachedDiscounts([discount()])
    expect(result).toHaveLength(0)
  })

  it("sums discounts across merged same-name/unit-price duplicates", () => {
    const a1 = product({ total_price: "2.00" })
    const a2 = product({ total_price: "2.00" })
    const result = withAttachedDiscounts([a1, discount("K Card Rabatt", "-0.30"), a2])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ quantity: "2", discountTotal: -0.3 })
  })
})

describe("effectiveUnitPrice", () => {
  it("divides the discounted total evenly across quantity", () => {
    const item = product({ quantity: "4", unit_price: "2.00", total_price: "8.00" })
    expect(effectiveUnitPrice(item, -2)).toBeCloseTo(1.5) // (8 - 2) / 4
  })

  it("equals the original unit price when there's no discount", () => {
    const item = product({ quantity: "2", unit_price: "2.00", total_price: "4.00" })
    expect(effectiveUnitPrice(item, 0)).toBeCloseTo(2.0)
  })
})
