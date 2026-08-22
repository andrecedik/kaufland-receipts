import { HashRouter, Route, Routes } from "react-router-dom"
import { Layout } from "@/components/Layout"
import { ReceiptsPage } from "@/pages/ReceiptsPage"
import { ReceiptDetailPage } from "@/pages/ReceiptDetailPage"
import { ItemPage } from "@/pages/ItemPage"
import { StatsPage } from "@/pages/StatsPage"

// HashRouter (not BrowserRouter) so routes work without server-side rewrite
// rules -- but this alone does NOT make the build openable via file://; see
// web/README.md for why (Chrome blocks ES module <script> tags on that
// origin), unlike the plain-HTML site/, which needs no server at all.
function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ReceiptsPage />} />
          <Route path="receipts/:id" element={<ReceiptDetailPage />} />
          <Route path="items/:slug" element={<ItemPage />} />
          <Route path="stats" element={<StatsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
