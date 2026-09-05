import { describe, expect, it } from "vitest"
import { formatVerdict } from "@/lib/receipts"
import type { PriceVerdict } from "@/lib/types"

function verdict(overrides: Partial<PriceVerdict>): PriceVerdict {
  return {
    median_price: "2.00",
    current_price: "1.70",
    percent_delta: "-15.0",
    label: "genuine",
    observation_count: 2,
    ...overrides,
  }
}

describe("formatVerdict", () => {
  it("describes a genuine discount", () => {
    expect(formatVerdict(verdict({ label: "genuine", percent_delta: "-15.0" }))).toBe(
      "15% below usual price",
    )
  })

  it("describes a marginal discount", () => {
    expect(formatVerdict(verdict({ label: "marginal", percent_delta: "-2.5" }))).toBe(
      "Only 3% off",
    )
  })

  it("describes a price that's worse than usual", () => {
    expect(formatVerdict(verdict({ label: "worse_than_usual", percent_delta: "10.0" }))).toBe(
      "10% above usual price",
    )
  })
})
