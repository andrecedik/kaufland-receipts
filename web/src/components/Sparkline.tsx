export interface SparklinePoint {
  date: string // YYYY-MM-DD
  price: number
}

/** Small hand-built line chart -- mirrors `_svg_sparkline` in the Python site generator. */
export function Sparkline({ points, width = 600, height = 180 }: { points: SparklinePoint[]; width?: number; height?: number }) {
  if (points.length === 0) return null

  const padL = 40
  const padR = 20
  const padT = 20
  const padB = 30
  const innerW = width - padL - padR
  const innerH = height - padT - padB

  const dates = points.map((p) => new Date(p.date).getTime())
  const prices = points.map((p) => p.price)
  const minD = Math.min(...dates)
  const maxD = Math.max(...dates)
  let minP = Math.min(...prices)
  let maxP = Math.max(...prices)
  if (minP === maxP) {
    minP -= 0.1
    maxP += 0.1
  }
  const dSpan = maxD - minD || 1
  const pSpan = maxP - minP

  const xOf = (d: number) => padL + (innerW * (d - minD)) / dSpan
  const yOf = (p: number) => padT + innerH * (1 - (p - minP) / pSpan)

  const coords = points.map((p) => ({ x: xOf(new Date(p.date).getTime()), y: yOf(p.price) }))
  const polyPoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ")

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-[600px] h-auto block">
      <polyline points={polyPoints} fill="none" stroke="var(--primary)" strokeWidth={2} />
      {points.map((p, i) => (
        <circle key={p.date + i} cx={coords[i].x} cy={coords[i].y} r={3.5} fill="var(--primary)">
          <title>{`${p.date}: ${p.price.toFixed(2)} EUR`}</title>
        </circle>
      ))}
      <text x={4} y={yOf(maxP)} fontSize={11} fill="var(--muted-foreground)">
        {maxP.toFixed(2)}
      </text>
      <text x={4} y={yOf(minP)} fontSize={11} fill="var(--muted-foreground)">
        {minP.toFixed(2)}
      </text>
      <text x={padL} y={height - 8} fontSize={11} fill="var(--muted-foreground)">
        {points[0].date}
      </text>
      <text x={width - padR} y={height - 8} fontSize={11} fill="var(--muted-foreground)" textAnchor="end">
        {points[points.length - 1].date}
      </text>
    </svg>
  )
}
