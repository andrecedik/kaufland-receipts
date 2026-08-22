// `purchased_at` is a naive datetime (no timezone marker) -- parsed here by
// hand into a local Date rather than via `new Date(iso)`, which would treat
// a bare "YYYY-MM-DD" as UTC midnight and could shift the displayed date by
// one day depending on the viewer's timezone.
export function parseLocal(iso: string): Date {
  const [datePart, timePart] = iso.split("T")
  const [y, m, d] = datePart.split("-").map(Number)
  const [hh, mm] = (timePart ?? "00:00").split(":").map(Number)
  return new Date(y, m - 1, d, hh, mm)
}

/** ISO datetime -> "21 Aug 2026, 21:03" */
export function fmtDateTime(iso: string): string {
  const dt = parseLocal(iso)
  return `${fmtDate(iso)}, ${dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}`
}

/** ISO date or datetime -> "21 Aug 2026" */
export function fmtDate(iso: string): string {
  return fmtDateObj(parseLocal(iso))
}

/** A real Date instance -> "21 Aug 2026" (for e.g. `new Date()`, not a parsed value) */
export function fmtDateObj(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

/** A real Date instance -> "21 Aug 2026, 21:03" (for e.g. `new Date()`, not a parsed value) */
export function fmtDateTimeObj(d: Date): string {
  return `${fmtDateObj(d)}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}`
}

/** "2026-08" -> "August 2026" */
export function fmtMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
}

/** "2026-08" -> "Aug 2026" (for tight spaces like a chart axis) */
export function fmtMonthShort(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" })
}

/** Plain "YYYY-MM-DD", for values that need to stay sortable/parseable (e.g. chart data). */
export function isoDate(iso: string): string {
  return iso.slice(0, 10)
}
