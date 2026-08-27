import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchGrocySettings, saveGrocyDefaults } from "@/lib/grocy"
import type { GrocySettings } from "@/lib/types"

export function GrocySettingsPage() {
  const [settings, setSettings] = useState<GrocySettings | null>(null)
  const [locationId, setLocationId] = useState<number | null>(null)
  const [quantityUnitId, setQuantityUnitId] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetchGrocySettings().then((s) => {
      setSettings(s)
      setLocationId(s.defaults?.location_id ?? s.locations[0]?.id ?? null)
      setQuantityUnitId(s.defaults?.quantity_unit_id ?? s.quantity_units[0]?.id ?? null)
    })
  }, [])

  if (!settings) return null

  async function save() {
    if (locationId === null || quantityUnitId === null) return
    await saveGrocyDefaults({ location_id: locationId, quantity_unit_id: quantityUnitId })
    setSaved(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Grocy settings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!settings.connected && (
          <p className="text-sm text-destructive">Not connected to Grocy — check GROCY_URL and GROCY_API_KEY.</p>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Default location
          <select
            value={locationId ?? ""}
            onChange={(e) => setLocationId(Number(e.target.value))}
          >
            {settings.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Default quantity unit
          <select
            value={quantityUnitId ?? ""}
            onChange={(e) => setQuantityUnitId(Number(e.target.value))}
          >
            {settings.quantity_units.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={save}>Save</Button>
        {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
      </CardContent>
    </Card>
  )
}
