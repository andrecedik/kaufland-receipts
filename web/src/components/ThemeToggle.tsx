import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"

const KEY = "kr-theme"

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function currentTheme(): "light" | "dark" {
  const stored = localStorage.getItem(KEY)
  if (stored === "light" || stored === "dark") return stored
  return systemPrefersDark() ? "dark" : "light"
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(() => currentTheme())

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])

  return (
    <Button
      id="theme-toggle"
      variant="outline"
      size="icon"
      className="rounded-full"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark"
        localStorage.setItem(KEY, next)
        setTheme(next)
      }}
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}
