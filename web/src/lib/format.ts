export function fmtDateTime(iso: string): string {
  const [date, time] = iso.split("T")
  return `${date} ${time?.slice(0, 5) ?? ""}`
}

export function fmtDate(iso: string): string {
  return iso.slice(0, 10)
}
