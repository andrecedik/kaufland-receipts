import { lazy, Suspense } from "react"
import { HashRouter, Route, Routes } from "react-router-dom"
import { Layout } from "@/components/Layout"

// Lazy-loaded per route so each page's vendor deps (recharts on StatsPage in
// particular -- it alone accounts for the bulk of the pre-split 748 kB main
// chunk) only download when that route is actually visited.
const ReceiptsPage = lazy(() => import("@/pages/ReceiptsPage").then((m) => ({ default: m.ReceiptsPage })))
const ReceiptDetailPage = lazy(() => import("@/pages/ReceiptDetailPage").then((m) => ({ default: m.ReceiptDetailPage })))
const ItemPage = lazy(() => import("@/pages/ItemPage").then((m) => ({ default: m.ItemPage })))
const StatsPage = lazy(() => import("@/pages/StatsPage").then((m) => ({ default: m.StatsPage })))
const UploadPage = lazy(() => import("@/pages/UploadPage").then((m) => ({ default: m.UploadPage })))

// HashRouter (not BrowserRouter) so routes work without server-side rewrite
// rules -- but this alone does NOT make the build openable via file://; see
// web/README.md for why (Chrome blocks ES module <script> tags on that
// origin), unlike the plain-HTML site/, which needs no server at all.
function App() {
  return (
    <HashRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<ReceiptsPage />} />
            <Route path="receipts/:id" element={<ReceiptDetailPage />} />
            <Route path="items/:slug" element={<ItemPage />} />
            <Route path="upload" element={<UploadPage />} />
            <Route path="stats" element={<StatsPage />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  )
}

export default App
