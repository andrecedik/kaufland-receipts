import type { GrocyPendingReceipt, GrocyProduct, GrocyProductDefaults, GrocySettings } from "@/lib/types"

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
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.detail ?? "Could not resolve the mapping.")
  return data
}

export async function retryReceiptPush(receiptId: string): Promise<{ all_pushed: boolean }> {
  const res = await fetch(`/api/grocy/receipts/${receiptId}/retry`, { method: "POST" })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.detail ?? "Retry failed.")
  return data
}

export async function fetchGrocySettings(): Promise<GrocySettings> {
  const res = await fetch("/api/grocy/settings")
  if (!res.ok) throw new Error("Could not load Grocy settings.")
  return res.json()
}

export async function saveGrocyDefaults(defaults: GrocyProductDefaults): Promise<void> {
  const res = await fetch("/api/grocy/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(defaults),
  })
  if (!res.ok) throw new Error("Could not save Grocy settings.")
}
