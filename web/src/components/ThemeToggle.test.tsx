// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { currentTheme } from "./ThemeToggle"

// Node 22+'s own experimental global `localStorage` (needs
// --localstorage-file to actually work) shadows jsdom's and is broken
// without it -- `localStorage.clear` isn't even a function. Replace it with
// a real in-memory implementation for these tests.
function installMemoryLocalStorage() {
  const store = new Map<string, string>()
  const storage: Storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => void store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  }
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true })
}

function stubSystemPreference(prefersDark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" && prefersDark,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

describe("currentTheme", () => {
  beforeEach(() => {
    installMemoryLocalStorage()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("uses the stored theme when one is saved, regardless of system preference", () => {
    stubSystemPreference(true)
    localStorage.setItem("kr-theme", "light")
    expect(currentTheme()).toBe("light")
  })

  it("falls back to the system preference when nothing is stored (dark)", () => {
    stubSystemPreference(true)
    expect(currentTheme()).toBe("dark")
  })

  it("falls back to the system preference when nothing is stored (light)", () => {
    stubSystemPreference(false)
    expect(currentTheme()).toBe("light")
  })

  it("ignores a garbage stored value and falls back to system preference", () => {
    stubSystemPreference(true)
    localStorage.setItem("kr-theme", "purple")
    expect(currentTheme()).toBe("dark")
  })
})
