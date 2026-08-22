import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fmtDate, fmtMonth, parseLocal } from "@/lib/format"

// tsconfig.app.json deliberately scopes `types` to `vite/client` only (no
// Node globals), to keep app code honestly browser-only -- this test file
// is the one exception that needs `process.env`, so it's declared locally
// rather than widening that config for the whole src/ tree.
declare const process: { env: Record<string, string | undefined> }

describe("parseLocal / date formatting in a negative-UTC-offset timezone", () => {
  // `new Date("2026-01-01")` treats a bare date as UTC midnight; in a
  // timezone behind UTC that displays as the previous day. parseLocal
  // exists specifically to avoid this -- reproduce the bug's exact
  // conditions here rather than trusting the machine's local timezone.
  const originalTz = process.env.TZ

  beforeEach(() => {
    process.env.TZ = "America/New_York" // UTC-5
  })

  afterEach(() => {
    process.env.TZ = originalTz
  })

  it("does not shift a bare date to the previous day", () => {
    expect(fmtDate("2026-01-01")).toBe("1 Jan 2026")
  })

  it("parses a datetime into the exact local calendar date and time", () => {
    const d = parseLocal("2026-01-01T23:30:00")
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(1)
    expect(d.getHours()).toBe(23)
    expect(d.getMinutes()).toBe(30)
  })

  it("does not shift the month either (fmtMonth)", () => {
    expect(fmtMonth("2026-01")).toBe("January 2026")
  })
})
