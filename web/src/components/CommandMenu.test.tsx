// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { CommandMenu } from "./CommandMenu"

// vitest's config doesn't set `globals: true`, so @testing-library/react's
// auto-cleanup (which relies on a global `afterEach`) never registers --
// without this, each render() leaves its container mounted.
afterEach(cleanup)

// cmdk (via Radix) uses ResizeObserver and scrollIntoView, neither of which
// jsdom implements.
beforeAll(() => {
  // @ts-expect-error -- minimal stub, only .observe/.disconnect are called
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.scrollIntoView = () => {}
})

function pressCmdK(repeat = false) {
  // fireEvent (not a raw dispatchEvent) so React's act() wrapping flushes
  // the resulting state update before the next assertion runs.
  fireEvent.keyDown(document, { key: "k", metaKey: true, repeat })
}

// The dialog's title/description render outside the Radix Portal (for
// screen readers) and stay in the DOM regardless of open state, so they
// can't be used to detect open/closed -- the search input lives inside the
// Portal-rendered, Presence-controlled DialogContent, so its presence
// tracks real visibility.
function isOpen() {
  return screen.queryByPlaceholderText("Search receipts, items, pages...") !== null
}

describe("CommandMenu", () => {
  it("opens on Cmd+K", () => {
    render(<CommandMenu />, { wrapper: MemoryRouter })
    expect(isOpen()).toBe(false)

    pressCmdK()
    expect(isOpen()).toBe(true)
  })

  it("ignores a held-down key-repeat event instead of re-toggling", () => {
    render(<CommandMenu />, { wrapper: MemoryRouter })

    pressCmdK() // real keydown -- opens
    expect(isOpen()).toBe(true)

    pressCmdK(true) // OS-generated repeat while held -- must be ignored
    expect(isOpen()).toBe(true)
  })

  it("a second real keydown closes it again", () => {
    render(<CommandMenu />, { wrapper: MemoryRouter })

    pressCmdK()
    expect(isOpen()).toBe(true)

    pressCmdK()
    expect(isOpen()).toBe(false)
  })
})
