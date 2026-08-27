// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GrocySettingsPage } from "./GrocySettingsPage"

afterEach(cleanup)

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`
      const body = routes[key]
      if (body === undefined) throw new Error(`Unmocked fetch: ${key}`)
      return Promise.resolve({ ok: true, json: async () => body })
    }),
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("GrocySettingsPage", () => {
  it("shows a not-connected message when Grocy isn't reachable", async () => {
    mockFetch({
      "GET /api/grocy/settings": { connected: false, defaults: null, locations: [], quantity_units: [] },
    })
    render(<GrocySettingsPage />)

    await waitFor(() => expect(screen.getByText(/not connected/i)).toBeTruthy())
  })

  it("saves the selected location and quantity unit", async () => {
    mockFetch({
      "GET /api/grocy/settings": {
        connected: true,
        defaults: null,
        locations: [{ id: 1, name: "Pantry" }],
        quantity_units: [{ id: 3, name: "Stück" }],
      },
      "PUT /api/grocy/settings": { status: "ok" },
    })
    render(<GrocySettingsPage />)
    await waitFor(() => expect(screen.getByText("Pantry")).toBeTruthy())

    fireEvent.change(screen.getByLabelText(/default location/i), { target: { value: "1" } })
    fireEvent.change(screen.getByLabelText(/default quantity unit/i), { target: { value: "3" } })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/grocy/settings",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ location_id: 1, quantity_unit_id: 3 }),
        }),
      ),
    )
  })
})
