import { NavLink, Outlet } from "react-router-dom"
import { CommandMenu } from "@/components/CommandMenu"
import { ThemeToggle } from "@/components/ThemeToggle"
import { fmtDateTimeObj } from "@/lib/format"
import { cn } from "@/lib/utils"

const TABS = [
  { to: "/", label: "Receipts", end: true },
  { to: "/upload", label: "Upload", end: false },
  { to: "/stats", label: "Statistics", end: false },
]

export function Layout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-4xl px-6 py-8 pb-16">
        <nav className="mb-7 flex items-center gap-7 border-b border-border">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  "-mb-px border-b-2 border-transparent pb-3 text-[0.95rem] font-semibold text-muted-foreground no-underline hover:text-foreground",
                  isActive && "border-primary text-foreground",
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
          <span className="flex-1" />
          <div className="mb-3 flex items-center gap-2">
            <CommandMenu />
            <ThemeToggle />
          </div>
        </nav>
        <Outlet />
        <p className="mt-12 text-sm text-muted-foreground">
          Generated on &middot; {fmtDateTimeObj(new Date())}
        </p>
      </main>
    </div>
  )
}
