import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './utils/supabase'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function Card({ item }) {
  return (
    <article className="card">
      <header>
        <div>
          <p className="ticker">{item.ticker || '—'}</p>
          <h3>{item.title || 'Recommendation'}</h3>
        </div>
        <span className={`pill tone-${(item.tone || 'neutral').toLowerCase()}`}>
          {(item.tone || 'neutral').toUpperCase()}
        </span>
      </header>
      {item.summary && (
        <div className="summary markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.summary}</ReactMarkdown>
        </div>
      )}
      <footer>
        <span className="meta">{item.date || ''}</span>
        <span className="meta">{item.source || 'model'}</span>
      </footer>
    </article>
  )
}

export default function App() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [authLoading, setAuthLoading] = useState(true)
  const [session, setSession] = useState(null)

  const hasResults = items && items.length > 0

  const countLabel = useMemo(() => (hasResults ? items.length : 0), [items, hasResults])

  // Auth bootstrap
  useEffect(() => {
    const init = async () => {
      const { data, error } = await supabase.auth.getSession()
      if (error) console.error(error)
      setSession(data?.session ?? null)
      setEmail(data?.session?.user?.email ?? '')
      setAuthLoading(false)
    }
    init()
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      setEmail(session?.user?.email ?? '')
    })
    return () => {
      listener?.subscription?.unsubscribe()
    }
  }, [])

  const handleGoogleLogin = async () => {
    setError('')
    setAuthLoading(true)
    const redirectTo = `${window.location.origin}/`
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (error) {
      setError(error.message)
      setAuthLoading(false)
    }
    // on success, Supabase will redirect; on return authLoading will reset in useEffect
  }

  const handleLogout = async () => {
    setLoading(true)
    await supabase.auth.signOut()
    setItems([])
    setLoading(false)
  }

  const fetchRuns = async () => {
    setError('')
    // Require an authenticated session; use the authed user's email for filtering
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession()
    if (sessionErr) {
      setError(sessionErr.message)
      return
    }
    const authedEmail = sessionData?.session?.user?.email || ''
    if (!authedEmail) {
      setError('Please sign in with Google to fetch your history.')
      return
    }
    setLoading(true)
    try {
      // Find user_id by email, then fetch runs for last 7 days, summaries only
      const { data: users, error: userErr } = await supabase
        .from('users')
        .select('id')
        .eq('wealthsimple_email', authedEmail)
        .limit(1)
      if (userErr) throw userErr
      if (!users || users.length === 0) {
        throw new Error('No user found for that email')
      }
      const userId = users[0].id

      const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const { data: runs, error: runsErr } = await supabase
        .from('runs')
        .select('summary, created_at')
        .eq('user_id', userId)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(200)
      if (runsErr) throw runsErr

      const mapped = (runs || []).map((r, idx) => ({
        id: idx,
        summary: r.summary || '',
        title: 'Run summary',
        ticker: '',
        date: r.created_at || '',
        source: 'runs',
        tone: 'neutral',
      }))
      setItems(mapped)
    } catch (err) {
      setError(err.message || 'Could not fetch history.')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Auto-fetch once authenticated
    if (session?.user?.email) {
      fetchRuns()
    } else {
      setItems([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.email])

  return (
    <div className="page">
      {!session ? (
        <main className="auth-container">
          <div className="panel auth-panel">
            <h1>Welcome back</h1>
            <p className="sub">Sign in with Google to view your portfolio run summaries.</p>
            <button type="button" onClick={handleGoogleLogin} disabled={authLoading}>
              {authLoading ? 'Opening Google…' : 'Continue with Google'}
            </button>
            {error && <p className="error">{error}</p>}
          </div>
        </main>
      ) : (
        <>
          <header className="hero">
            <div>
              <p className="eyebrow">Scorpio · portfolio insights</p>
              <h1>Run summaries</h1>
              <p className="sub">Showing the last 7 days for {session.user.email}</p>
            </div>
            <div className="hero-actions">
              <button type="button" onClick={fetchRuns} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button type="button" className="ghost" onClick={handleLogout} disabled={loading}>
                Sign out
              </button>
            </div>
          </header>

          <section className="panel" id="results">
            <div className="results-head">
              <h2>Prediction history</h2>
              <span className="pill">{countLabel}</span>
            </div>
            {loading && <div className="empty-state">Loading…</div>}
            {!loading && !hasResults && !error && (
              <div className="empty-state">No results yet from the last 7 days.</div>
            )}
            {error && <p className="error">{error}</p>}
            {hasResults && (
              <div className="timeline">
                {items.map((item, idx) => (
                  <Card key={`${item.ticker || 'item'}-${idx}`} item={item} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
