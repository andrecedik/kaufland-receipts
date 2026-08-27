import type { GrocyPendingReceipt, GrocyProduct } from "@/lib/types"

export async function fetchPending(): Promise<GrocyPendingReceipt[]> {
  const res = await fetch("/api/grocy/pending")
  if (!res.ok) throw new Error("Could not load pending Grocy items.")
  return res.json()
}

export async function searchGrocyProducts(query: string): Promise<GrocyProduct[]> {
  const res = await fetch(`/api/grocy/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error("Could not search Grocy products.")
  return res.json()
}

export async function resolveMapping(params: {
  raw_name: string
  grocy_product_id?: number
  new_product_name?: string
  skipped?: boolean
}): Promise<{ pushed_receipt_ids: string[] }> {
  const res = await fetch("/api/grocy/mappings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error("Could not resolve the mapping.")
  return res.json()
}

export async function retryReceiptPush(receiptId: string): Promise<{ all_pushed: boolean }> {
  const res = await fetch(`/api/grocy/receipts/${receiptId}/retry`, { method: "POST" })
  if (!res.ok) throw new Error("Retry failed.")
  return res.json()
}
