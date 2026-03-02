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
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Resolve user id on mount
  useEffect(() => {
    const fetchUserId = async () => {
      setError('')
      setMessage('')
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
      } catch (e) {
        setError(e.message || 'Could not resolve user')
      }
    }
    fetchUserId()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.email])

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
    </div>
  )
}

