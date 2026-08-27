// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"
import { GrocyPage } from "./GrocyPage"
import type { GrocyPendingReceipt, GrocyProduct } from "@/lib/types"

afterEach(cleanup)

// cmdk (via Radix) uses ResizeObserver and scrollIntoView, neither of which
// jsdom implements -- same stub as CommandMenu.test.tsx.
beforeAll(() => {
  // @ts-expect-error -- minimal stub, only .observe/.disconnect are called
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.scrollIntoView = () => {}
})

function pending(overrides: Partial<GrocyPendingReceipt> = {}): GrocyPendingReceipt {
  return {
    receipt_id: "r1",
    purchased_at: "2026-08-27T10:00:00",
    store_name: "Kaufland",
    total: "2.00",
    currency: "EUR",
    unresolved: [{ index: 0, name: "Milch" }],
    failed: [],
    ...overrides,
  }
}

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url.split("?")[0]}`
      const body = routes[key]
      if (body === undefined) throw new Error(`Unmocked fetch: ${key}`)
      return Promise.resolve({ ok: true, json: async () => body })
    }),
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("GrocyPage", () => {
  it("lists an unresolved item for a pending receipt", async () => {
    mockFetch({ "GET /api/grocy/pending": [pending()] })
    render(<GrocyPage />, { wrapper: MemoryRouter })

    await waitFor(() => expect(screen.getByText("Milch")).toBeTruthy())
    expect(screen.getByText(/Kaufland/)).toBeTruthy()
  })

  it("resolves an item by picking a search result", async () => {
    const searchResult: GrocyProduct[] = [{ id: 1, name: "H-Milch" }]
    mockFetch({
      "GET /api/grocy/pending": [pending()],
      "GET /api/grocy/search": searchResult,
      "POST /api/grocy/mappings": { pushed_receipt_ids: ["r1"] },
    })
    render(<GrocyPage />, { wrapper: MemoryRouter })
    await waitFor(() => expect(screen.getByText("Milch")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: /map "milch"/i }))
    fireEvent.change(screen.getByPlaceholderText(/search grocy products/i), { target: { value: "Milch" } })
    await waitFor(() => expect(screen.getByText("H-Milch")).toBeTruthy())
    fireEvent.click(screen.getByText("H-Milch"))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/grocy/mappings",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ raw_name: "Milch", grocy_product_id: 1 }),
        }),
      ),
    )
  })

  it("copies the raw item name into the search box", async () => {
    mockFetch({
      "GET /api/grocy/pending": [pending()],
      "GET /api/grocy/search": [],
    })
    render(<GrocyPage />, { wrapper: MemoryRouter })
    await waitFor(() => expect(screen.getByText("Milch")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: /map "milch"/i }))
    fireEvent.click(screen.getByRole("button", { name: /use "milch" as the search text/i }))

    const input = screen.getByPlaceholderText(/search grocy products/i) as HTMLInputElement
    expect(input.value).toBe("Milch")
  })

  it("shows a spinner on the Create button while the request is in flight", async () => {
    mockFetch({
      "GET /api/grocy/pending": [pending()],
      "GET /api/grocy/search": [],
    })
    render(<GrocyPage />, { wrapper: MemoryRouter })
    await waitFor(() => expect(screen.getByText("Milch")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: /map "milch"/i }))
    fireEvent.change(screen.getByPlaceholderText(/search grocy products/i), { target: { value: "Neue Milch" } })
    const createButton = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement
    await waitFor(() => expect(createButton.disabled).toBe(false))

    let resolveMappingsRequest: (value: unknown) => void = () => {}
    const fetchMock = fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveMappingsRequest = resolve }),
    )
    fireEvent.click(createButton)

    await waitFor(() => expect(createButton.disabled).toBe(true))
    expect(document.querySelector(".animate-spin")).toBeTruthy()

    resolveMappingsRequest({ ok: true, json: async () => ({ pushed_receipt_ids: ["r1"] }) })
    await waitFor(() => expect(document.querySelector(".animate-spin")).toBeNull())
  })

  it("resolves an item as skipped", async () => {
    mockFetch({
      "GET /api/grocy/pending": [pending()],
      "POST /api/grocy/mappings": { pushed_receipt_ids: ["r1"] },
    })
    render(<GrocyPage />, { wrapper: MemoryRouter })
    await waitFor(() => expect(screen.getByText("Milch")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: /skip "milch"/i }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/grocy/mappings",
        expect.objectContaining({
          body: JSON.stringify({ raw_name: "Milch", skipped: true }),
        }),
      ),
    )
  })

  it("shows a retry button for a failed item and calls the retry endpoint", async () => {
    mockFetch({
      "GET /api/grocy/pending": [
        pending({ unresolved: [], failed: [{ index: 0, name: "Milch", error: "Grocy unreachable" }] }),
      ],
      "POST /api/grocy/receipts/r1/retry": { all_pushed: true },
    })
    render(<GrocyPage />, { wrapper: MemoryRouter })

    await waitFor(() => expect(screen.getByText(/grocy unreachable/i)).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /retry/i }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/grocy/receipts/r1/retry", expect.objectContaining({ method: "POST" })),
    )
  })

  it("shows the server's error message when a retry fails", async () => {
    mockFetch({
      "GET /api/grocy/pending": [
        pending({ unresolved: [], failed: [{ index: 0, name: "Milch", error: "Grocy unreachable" }] }),
      ],
    })
    render(<GrocyPage />, { wrapper: MemoryRouter })
    await waitFor(() => expect(screen.getByText(/grocy unreachable/i)).toBeTruthy())

    const fetchMock = fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ detail: "Receipt is not fully mapped yet." }),
    })
    fireEvent.click(screen.getByRole("button", { name: /retry/i }))

    await waitFor(() => expect(screen.getByText("Receipt is not fully mapped yet.")).toBeTruthy())
  })
})
