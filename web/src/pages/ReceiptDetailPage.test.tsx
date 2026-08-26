// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { receipts } from "@/lib/receipts"
import type { LineItem, Receipt, Store } from "@/lib/types"
import { ReceiptDetailPage } from "./ReceiptDetailPage"

afterEach(cleanup)

// vaul (the drawer's underlying library) checks window.matchMedia on mount
// to detect standalone/PWA display mode -- jsdom doesn't implement it.
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
})

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
    receipt_id: "kaufland-test-1",
    purchased_at: "2026-08-14T10:00:00",
    store: STORE,
    line_items: [lineItem({ total_price: "3.50" })],
    total: "3.50",
    currency: "EUR",
    source: "pdf",
    source_file: null,
    pdf_available: false,
    threshold_coupon_discount: null,
    ...overrides,
  }
}

beforeEach(() => {
  receipts.length = 0
})

function renderDetail(id: string) {
  render(
    <MemoryRouter initialEntries={[`/receipts/${id}`]}>
      <Routes>
        <Route path="/receipts/:id" element={<ReceiptDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe("ReceiptDetailPage ingestion-info drawer", () => {
  it("shows a neutral 'View Info' button when totals reconcile, closed by default", () => {
    receipts.push(receipt({}))
    renderDetail("kaufland-test-1")

    const button = screen.getByRole("button", { name: "View Info" })
    expect(button.getAttribute("data-variant")).toBe("outline")
    expect(screen.queryByText("Receipt info")).toBeNull() // drawer content not mounted until opened
  })

  it("opens to show the receipt id, source, and a matching-totals message", () => {
    receipts.push(receipt({}))
    renderDetail("kaufland-test-1")

    fireEvent.click(screen.getByRole("button", { name: "View Info" }))

    expect(screen.getByText("Receipt info")).toBeTruthy()
    expect(screen.getByText("kaufland-test-1")).toBeTruthy()
    expect(screen.getByText("pdf")).toBeTruthy()
    expect(screen.getByText("✓ matches printed total")).toBeTruthy()
  })

  it("switches to a warning-styled button and message when totals don't reconcile", () => {
    receipts.push(receipt({ total: "999.99" })) // line items still sum to 3.50
    renderDetail("kaufland-test-1")

    const button = screen.getByRole("button", { name: "View Info" })
    expect(button.getAttribute("data-variant")).toBe("destructive")
    fireEvent.click(button)

    expect(screen.getByText("⚠ line items sum to 3.50, printed total is 999.99")).toBeTruthy()
  })
})

describe("ReceiptDetailPage price verdicts", () => {
  it("shows a verdict badge next to a line item that has one", () => {
    receipts.push(
      receipt({
        line_items: [
          lineItem({
            name: "Milch",
            total_price: "1.70",
            price_verdict: {
              median_price: "2.00",
              current_price: "1.70",
              percent_delta: "-15.0",
              label: "genuine",
              observation_count: 2,
            },
          }),
        ],
        total: "1.70",
      }),
    )
    renderDetail("kaufland-test-1")

    expect(screen.getByText("15% below your usual price")).toBeTruthy()
  })

  it("shows nothing extra for a line item with no verdict", () => {
    receipts.push(receipt({ line_items: [lineItem({ name: "Brot", total_price: "1.50" })], total: "1.50" }))
    renderDetail("kaufland-test-1")

    expect(screen.queryByText(/your usual price/)).toBeNull()
    expect(screen.queryByText(/not much of a bargain/)).toBeNull()
  })
})
