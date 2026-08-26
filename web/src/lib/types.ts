// Mirrors kaufland_receipts.models — decimals arrive as strings from
// `kaufland export --format json` (pydantic's JSON mode) and are parsed to
// numbers here; this is a read-only display layer, not a place that needs
// arbitrary-precision arithmetic.

export interface PriceVerdict {
  median_price: string
  current_price: string
  percent_delta: string
  label: string
  observation_count: number
}

export interface LineItem {
  name: string
  quantity: string
  unit_price: string | null
  total_price: string
  tax_class: string | null
  article_number: string | null
  size_value: string | null
  size_unit: string | null
  price_verdict?: PriceVerdict
}

export interface Store {
  name: string
  street: string | null
  city: string | null
  postal_code: string | null
}

export interface Receipt {
  receipt_id: string
  purchased_at: string
  store: Store
  line_items: LineItem[]
  total: string
  currency: string
  source: string
  source_file: string | null
  // Whether web-data actually copied the PDF into public/pdfs/ -- distinct
  // from source_file, which is the ingest-time path and can go stale.
  pdf_available: boolean
}
