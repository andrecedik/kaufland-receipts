// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { receipts } from "@/lib/receipts"
import type { Receipt, Store } from "@/lib/types"
import { ReceiptsPage } from "./ReceiptsPage"

afterEach(cleanup)

const STORE: Store = { name: "Kaufland Test", street: null, city: null, postal_code: null }

function receipt(i: number): Receipt {
  const day = String(i + 1).padStart(2, "0")
  return {
    receipt_id: `r${i}`,
    purchased_at: `2026-01-${day}T09:00:00`,
    store: STORE,
    line_items: [],
    total: `${i + 1}.00`,
    currency: "EUR",
    source: "test",
    source_file: null,
    pdf_available: false,
  }
}

// `receipts` is the module-level array ReceiptsPage reads directly (loaded
// at runtime by loadReceipts() in main.tsx, see receipts.derived.test.ts);
// each test fills it fresh so pagination math (25 receipts -> 3 pages of 10)
// stays predictable regardless of test order.
beforeEach(() => {
  receipts.length = 0
  for (let i = 0; i < 25; i++) receipts.push(receipt(i))
})

function renderPage() {
  render(<ReceiptsPage />, { wrapper: MemoryRouter })
}

function isDisabled(name: string): boolean {
  return (screen.getByRole("button", { name }) as HTMLButtonElement).disabled
}

describe("ReceiptsPage pagination", () => {
  it("shows only the first 10 rows by default, newest first", () => {
    renderPage()
    expect(screen.getByText("Showing 1–10 of 25")).toBeTruthy()
    expect(screen.getByText("Page 1 of 3")).toBeTruthy()
    expect(screen.getByText("25.00 EUR")).toBeTruthy() // newest receipt (r24)
    expect(screen.queryByText("15.00 EUR")).toBeNull() // page 2 only
    expect(isDisabled("Previous page")).toBe(true)
  })

  it("Next page advances to the next slice", () => {
    renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(screen.getByText("Showing 11–20 of 25")).toBeTruthy()
    expect(screen.getByText("Page 2 of 3")).toBeTruthy()
    expect(screen.queryByText("25.00 EUR")).toBeNull()
  })

  it("disables Next on the last (partial) page", () => {
    renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(screen.getByText("Showing 21–25 of 25")).toBeTruthy()
    expect(screen.getByText("Page 3 of 3")).toBeTruthy()
    expect(isDisabled("Next page")).toBe(true)
  })

  it("switching page size resets to page 1 and can show everything on one page", () => {
    renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Next page" })) // move off page 1 first
    fireEvent.click(screen.getByRole("button", { name: "50" }))
    expect(screen.getByText("Showing 1–25 of 25")).toBeTruthy()
    expect(screen.getByText("Page 1 of 1")).toBeTruthy()
    expect(isDisabled("Next page")).toBe(true)
  })

  it("filtering to fewer rows than the current page resets back to page 1", () => {
    renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Next page" })) // page 2
    fireEvent.change(screen.getByPlaceholderText("Filter by store, date, or receipt id..."), {
      target: { value: "r24" }, // unique receipt_id substring -- matches only one row
    })
    expect(screen.getByText("Showing 1–1 of 1")).toBeTruthy()
    expect(screen.getByText("Page 1 of 1")).toBeTruthy()
  })
})
