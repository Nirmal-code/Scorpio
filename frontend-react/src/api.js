// Fetch run summaries for a user by email (last 7 days on the backend)
// Expects backend endpoint: GET /history?email=you@example.com returning JSON array of summary strings
export async function fetchHistory(apiBase, email) {
  const url = `${apiBase.replace(/\/$/, '')}/runs?email=${encodeURIComponent(email)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (res.status === 429) {
    throw new Error('Rate limited; please retry shortly.')
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Request failed (${res.status}): ${text || res.statusText}`)
  }
  const data = await res.json()
  // Normalize to objects the UI can render
  if (Array.isArray(data)) {
    return data.map((summary, idx) => ({
      summary: summary || '',
      title: 'Run summary',
      ticker: '',
      date: '',
      source: 'runs',
      id: idx,
    }))
  }
  return []
}
