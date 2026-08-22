import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Sparkline } from "./Sparkline"

describe("Sparkline", () => {
  it("shows the date once for a single point", () => {
    const svg = renderToStaticMarkup(<Sparkline points={[{ date: "2026-08-14", price: 2.99 }]} />)
    expect((svg.match(/y="172"/g) ?? []).length).toBe(1)
    expect(svg).toContain("14 Aug 2026</text>")
    expect((svg.match(/<circle/g) ?? []).length).toBe(1)
  })

  it("shows start and end dates for multiple points", () => {
    const svg = renderToStaticMarkup(
      <Sparkline
        points={[
          { date: "2026-06-22", price: 1.99 },
          { date: "2026-08-21", price: 2.19 },
        ]}
      />,
    )
    expect((svg.match(/y="172"/g) ?? []).length).toBe(2)
    expect(svg).toContain("22 Jun 2026</text>")
    expect(svg).toContain("21 Aug 2026</text>")
  })

  it("draws one circle per point", () => {
    const svg = renderToStaticMarkup(
      <Sparkline
        points={[
          { date: "2026-01-01", price: 1 },
          { date: "2026-02-01", price: 2 },
          { date: "2026-03-01", price: 3 },
        ]}
      />,
    )
    expect((svg.match(/<circle/g) ?? []).length).toBe(3)
  })
})
