import { describe, expect, it } from "vitest"
import { isSupportedNodeVersion } from "./check-node-version.mjs"

describe("isSupportedNodeVersion", () => {
  it("rejects Node 20 below .19", () => {
    expect(isSupportedNodeVersion(20, 18)).toBe(false)
  })

  it("accepts Node 20.19 and above", () => {
    expect(isSupportedNodeVersion(20, 19)).toBe(true)
    expect(isSupportedNodeVersion(20, 25)).toBe(true)
  })

  it("rejects Node 21 entirely (not a supported major)", () => {
    expect(isSupportedNodeVersion(21, 0)).toBe(false)
  })

  it("rejects Node 22 below .12", () => {
    expect(isSupportedNodeVersion(22, 11)).toBe(false)
  })

  it("accepts Node 22.12 and above", () => {
    expect(isSupportedNodeVersion(22, 12)).toBe(true)
  })

  it("accepts any Node major above 22", () => {
    expect(isSupportedNodeVersion(23, 0)).toBe(true)
    expect(isSupportedNodeVersion(25, 6)).toBe(true)
  })
})
