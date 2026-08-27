import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchPending, resolveMapping, retryReceiptPush, searchGrocyProducts } from "@/lib/grocy"

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("grocy.ts fetch helpers", () => {
  it("fetchPending calls GET /api/grocy/pending", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [] })
    await fetchPending()
    expect(fetch).toHaveBeenCalledWith("/api/grocy/pending")
  })

  it("searchGrocyProducts encodes the query", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [] })
    await searchGrocyProducts("H-Milch 3,5%")
    expect(fetch).toHaveBeenCalledWith("/api/grocy/search?q=H-Milch%203%2C5%25")
  })

  it("resolveMapping POSTs the resolution", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ pushed_receipt_ids: ["r1"] }),
    })
    const result = await resolveMapping({ raw_name: "Milch", grocy_product_id: 1 })
    expect(fetch).toHaveBeenCalledWith(
      "/api/grocy/mappings",
      expect.objectContaining({ method: "POST" }),
    )
    expect(result.pushed_receipt_ids).toEqual(["r1"])
  })

  it("retryReceiptPush POSTs to the receipt's retry endpoint", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ all_pushed: true }) })
    await retryReceiptPush("r1")
    expect(fetch).toHaveBeenCalledWith("/api/grocy/receipts/r1/retry", expect.objectContaining({ method: "POST" }))
  })
})
