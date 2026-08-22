import { HashRouter, Route, Routes } from "react-router-dom"
import { Layout } from "@/components/Layout"
import { ReceiptsPage } from "@/pages/ReceiptsPage"
import { ReceiptDetailPage } from "@/pages/ReceiptDetailPage"
import { ItemPage } from "@/pages/ItemPage"
import { StatsPage } from "@/pages/StatsPage"

// HashRouter (not BrowserRouter) so the built site opens straight from disk
// via file:// -- same requirement as the plain-HTML site/, no server needed.
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
