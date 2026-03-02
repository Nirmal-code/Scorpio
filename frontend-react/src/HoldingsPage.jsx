import React, { useEffect, useState } from 'react'
import { supabase } from './utils/supabase'

export default function HoldingsPage({ session, onNoUser }) {
  const [form, setForm] = useState({
    ticker: '',
    quantity: '',
    avg_cost: '',
    market_value: '',
    book_value: '',
  })
  const [userId, setUserId] = useState(null)
  const [holdings, setHoldings] = useState([])
  const [loading, setLoading] = useState(false)
  const [resolvingUser, setResolvingUser] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Resolve user id on mount
  useEffect(() => {
    const fetchUserId = async () => {
      setError('')
      setMessage('')
      setResolvingUser(true)
      try {
        const authedEmail = session?.user?.email || ''
        if (!authedEmail) throw new Error('No session email found')
        const { data, error: userErr } = await supabase
          .from('users')
          .select('id')
          .eq('wealthsimple_email', authedEmail)
          .maybeSingle()
        if (userErr) throw userErr
        if (!data) {
          onNoUser?.()
          return
        }
        setUserId(data.id)
        await fetchHoldings(data.id)
      } catch (e) {
        setError(e.message || 'Could not resolve user')
      }
      setResolvingUser(false)
    }
    fetchUserId()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.email])

  const fetchHoldings = async (uid) => {
    if (!uid) return
    try {
      const { data, error: hErr } = await supabase
        .from('holdings')
        .select('ticker, quantity, avg_cost, market_value, book_value')
        .eq('user_id', uid)
        .order('ticker', { ascending: true })
      if (hErr) throw hErr
      setHoldings(data || [])
    } catch (e) {
      setError(e.message || 'Could not fetch holdings.')
    }
  }

  const onChange = (e) => {
    const { name, value } = e.target
    setForm((f) => ({ ...f, [name]: value }))
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    if (!userId) {
      setError('User not resolved yet.')
      return
    }
    if (!form.ticker) {
      setError('Ticker is required.')
      return
    }

    const payload = {
      user_id: userId,
      ticker: form.ticker.trim().toUpperCase(),
      quantity: form.quantity ? Number(form.quantity) : null,
      avg_cost: form.avg_cost ? Number(form.avg_cost) : null,
      market_value: form.market_value ? Number(form.market_value) : null,
      book_value: form.book_value ? Number(form.book_value) : null,
    }

    setLoading(true)
    try {
      const { error: upsertErr } = await supabase
        .from('holdings')
        .upsert(payload, { onConflict: 'user_id,ticker' })
      if (upsertErr) throw upsertErr
      setMessage('Saved!')
      await fetchHoldings(userId)
    } catch (e) {
      setError(e.message || 'Could not save holding.')
    } finally {
      setLoading(false)
    }
  }

  const onClear = () => {
    setForm({ ticker: '', quantity: '', avg_cost: '', market_value: '', book_value: '' })
    setMessage('')
    setError('')
  }

  const onEdit = (h) => {
    setForm({
      ticker: h.ticker || '',
      quantity: h.quantity ?? '',
      avg_cost: h.avg_cost ?? '',
      market_value: h.market_value ?? '',
      book_value: h.book_value ?? '',
    })
  }

  const onDelete = async (ticker) => {
    if (!userId || !ticker) return
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const { error: delErr } = await supabase
        .from('holdings')
        .delete()
        .eq('user_id', userId)
        .eq('ticker', ticker)
      if (delErr) throw delErr
      setMessage('Deleted.')
      await fetchHoldings(userId)
    } catch (e) {
      setError(e.message || 'Could not delete holding.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Scorpio · holdings editor</p>
          <h1>Update a holding</h1>
          <p className="sub">Add or edit a ticker for {session?.user?.email || ''}</p>
        </div>
        <div className="hero-actions" />
      </header>

      {resolvingUser && <div className="empty-state">Resolving user…</div>}
      {!resolvingUser && error && <p className="error">{error}</p>}

      {!resolvingUser && (
        <section className="panel">
          <form className="form-grid" onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="ticker">Ticker *</label>
              <input id="ticker" name="ticker" value={form.ticker} onChange={onChange} required />
            </div>
            <div className="field">
              <label htmlFor="quantity">Quantity</label>
              <input
                id="quantity"
                name="quantity"
                type="number"
                step="any"
                value={form.quantity}
                onChange={onChange}
              />
            </div>
            <div className="field">
              <label htmlFor="avg_cost">Avg Cost</label>
              <input
                id="avg_cost"
                name="avg_cost"
                type="number"
                step="any"
                value={form.avg_cost}
                onChange={onChange}
              />
            </div>
            <div className="field">
              <label htmlFor="market_value">Market Value</label>
              <input
                id="market_value"
                name="market_value"
                type="number"
                step="any"
                value={form.market_value}
                onChange={onChange}
              />
            </div>
            <div className="field">
              <label htmlFor="book_value">Book Value</label>
              <input
                id="book_value"
                name="book_value"
                type="number"
                step="any"
                value={form.book_value}
                onChange={onChange}
              />
            </div>

            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={loading || !userId}>
                {loading ? 'Saving…' : 'Save holding'}
              </button>
              <button type="button" className="ghost" onClick={onClear} disabled={loading}>
                Clear
              </button>
            </div>
            {message && <p className="success">{message}</p>}
            {error && <p className="error">{error}</p>}
          </form>
        </section>
      )}

      {!resolvingUser && (
        <section className="panel">
          <div className="results-head">
            <h2>Current holdings</h2>
            <span className="pill">{holdings.length}</span>
          </div>
          {holdings.length === 0 && <div className="empty-state">No holdings yet.</div>}
          {holdings.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Qty</th>
                    <th>Avg Cost</th>
                    <th>Market Value</th>
                    <th>Book Value</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h) => (
                    <tr key={h.ticker}>
                      <td>{h.ticker}</td>
                      <td>{h.quantity ?? ''}</td>
                      <td>{h.avg_cost ?? ''}</td>
                      <td>{h.market_value ?? ''}</td>
                      <td>{h.book_value ?? ''}</td>
                      <td className="actions">
                        <button type="button" className="ghost compact" onClick={() => onEdit(h)} disabled={loading}>
                          Edit
                        </button>
                        <button type="button" className="ghost danger compact" onClick={() => onDelete(h.ticker)} disabled={loading}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
