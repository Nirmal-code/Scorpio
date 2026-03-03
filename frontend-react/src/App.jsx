import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './utils/supabase'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, NavLink } from 'react-router-dom'
import HoldingsPage from './HoldingsPage'

function Card({ item }) {
  return (
    <article className="card">
      <header>
        <div>
          <p className="meta date-top">{item.date || ''}</p>
          <p className="ticker">{item.ticker || '—'}</p>
          <h3>{item.title || 'Run summary'}</h3>
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
        <span className="meta">{item.source || 'runs'}</span>
      </footer>
    </article>
  )
}

/**
 * OAuth callback handler that prevents redirect races:
 * - Exchanges ?code=...
 * - Waits for supabase.auth.getSession()
 * - Pushes session into App state immediately (onSession)
 */
function AuthCallbackPage({ onSession, onError }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    let cancelled = false

    const complete = async () => {
      try {
        setLocalError('')
        onError?.('')

        const params = new URLSearchParams(location.search)
        const err = params.get('error_description') || params.get('error')
        if (err) throw new Error(err)

        const code = params.get('code')
        if (code) {
          const { error: exErr } = await supabase.auth.exchangeCodeForSession(code)
          if (exErr) throw exErr
        }

        const { data, error: sessErr } = await supabase.auth.getSession()
        if (sessErr) throw sessErr
        const sess = data?.session ?? null
        if (!sess) {
          throw new Error('Login completed but no session was created. Check Supabase Auth redirect URLs.')
        }

        if (!cancelled) {
          onSession?.(sess)
          navigate('/summaries', { replace: true })
        }
      } catch (e) {
        const msg = e?.message || 'Could not complete sign-in.'
        if (!cancelled) {
          setLocalError(msg)
          onError?.(msg)
          navigate('/login', { replace: true })
        }
      }
    }

    complete()
    return () => {
      cancelled = true
    }
  }, [location.search, navigate, onSession, onError])

  return (
    <main className="page auth-container">
      <div className="panel auth-panel">
        <h1>Signing you in…</h1>
        <p className="sub">Completing Google sign-in.</p>
        {localError && <p className="error">{localError}</p>}
      </div>
    </main>
  )
}

function RequireAuth({ session, authChecked, children }) {
  const location = useLocation()
  if (!authChecked) {
    return (
      <main className="page">
        <div className="empty-state">Checking session…</div>
      </main>
    )
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

export default function App() {
  const [session, setSession] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)

  const [error, setError] = useState('')
  const [items, setItems] = useState([])
  const [refreshing, setRefreshing] = useState(false)

  const [userId, setUserId] = useState(null)

  const hasResults = items.length > 0
  const countLabel = useMemo(() => (hasResults ? items.length : 0), [hasResults, items.length])

  // Auth bootstrap: does NOT log you out on refresh.
  useEffect(() => {
    let mounted = true

    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (!mounted) return
        if (error) setError(error.message)
        setSession(data?.session ?? null)
      } catch (e) {
        if (mounted) setError(e?.message || 'Could not check session')
      } finally {
        if (mounted) setAuthChecked(true)
      }
    }

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return
      setSession(newSession ?? null)
    })

    init()
    return () => {
      mounted = false
      listener?.subscription?.unsubscribe()
    }
  }, [])

  // Public users table: find or create row. NEVER sign out due to DB issues.
  const ensureUserRow = async (email) => {
    if (!email) return null

    const { data: existing, error: selErr } = await supabase
      .from('users')
      .select('id')
      .eq('wealthsimple_email', email)
      .maybeSingle()

    if (selErr) throw selErr
    if (existing?.id) return existing.id

    const generatedId = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000))
    const { data: created, error: insErr } = await supabase
      .from('users')
      .insert({ id: generatedId.toString(), wealthsimple_email: email })
      .select('id')
      .maybeSingle()

    if (!insErr && created?.id) return created.id

    // possible race — re-read
    const { data: reread, error: rrErr } = await supabase
      .from('users')
      .select('id')
      .eq('wealthsimple_email', email)
      .maybeSingle()
    if (rrErr) throw rrErr
    return reread?.id ?? null
  }

  // When session changes: compute userId.
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setError('')
      setItems([])
      setUserId(null)

      const email = session?.user?.email
      if (!email) return

      try {
        const uid = await ensureUserRow(email)
        if (cancelled) return
        setUserId(uid)
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Could not load user.')
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [session?.user?.email])

  const fetchRuns = async (uid) => {
    if (!uid) return
    setError('')
    setRefreshing(true)
    try {
      const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const { data: runs, error: runsErr } = await supabase
        .from('runs')
        .select('summary, created_at')
        .eq('user_id', uid)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(200)

      if (runsErr) throw runsErr

      const mapped = (runs || []).map((r, idx) => ({
        id: idx,
        summary: r.summary || '',
        title: 'Run summary',
        ticker: '',
        date: r.created_at ? new Date(r.created_at).toLocaleString() : '',
        source: 'runs',
        tone: 'neutral',
      }))
      setItems(mapped)
    } catch (e) {
      setError(e?.message || 'Could not fetch history.')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (userId) fetchRuns(userId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const handleGoogleLogin = async () => {
    try {
      setError('')
      setAuthBusy(true)
      const redirectTo = `${window.location.origin}/auth/callback`
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      })
      if (error) throw error
    } catch (e) {
      setError(e?.message || 'Could not start Google sign-in.')
      setAuthBusy(false)
    }
  }

  const handleLogout = async () => {
    setError('')
    await supabase.auth.signOut()
    // session will clear via onAuthStateChange
  }

  function LoginPage() {
    return (
      <main className="page auth-container single">
        <div className="panel auth-panel auth-single">
          <p className="eyebrow">Scorpio · portfolio intelligence</p>
          <h1>Sign in to Scorpio</h1>
          <p className="sub">Continue with Google to view your portfolio summaries.</p>
          <button type="button" className="btn-primary full" onClick={handleGoogleLogin} disabled={authBusy}>
            <span className="google-icon" aria-hidden="true">
              <svg viewBox="0 0 48 48" focusable="false">
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.72 1.22 9.22 3.6l6.86-6.86C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.55 13.22l8 6.22C12.57 12.62 17.83 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.14 24.55c0-1.64-.15-3.21-.43-4.73H24v9h12.55c-.54 2.9-2.18 5.36-4.64 7.03l7.39 5.72c4.31-3.98 6.84-9.86 6.84-16.99z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.55 28.05c-.48-1.4-.76-2.9-.76-4.44s.28-3.04.76-4.44l-8-6.22C1.07 15.7 0 19.22 0 23c0 3.78 1.07 7.3 2.55 9.99l8-6.22z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.9-2.13 15.87-5.78l-7.39-5.72c-2.06 1.38-4.7 2.2-8.48 2.2-6.17 0-11.43-3.12-13.87-9.27l-8 6.22C6.51 42.62 14.62 48 24 48z"
                />
                <path fill="none" d="M0 0h48v48H0z" />
              </svg>
            </span>
            {authBusy ? 'Opening Google…' : 'Continue with Google'}
          </button>
          <p className="hint">Google sign-in only · secure via Supabase Auth.</p>
          {error && <p className="error">{error}</p>}
        </div>
      </main>
    )
  }

  function SummariesPage() {
    const email = session?.user?.email
    const timelineRef = useRef(null)

    return (
      <div className="page">
        <header className="hero">
          <div>
            <p className="eyebrow">Scorpio · portfolio insights</p>
            <h1>Run summaries</h1>
            <p className="sub">Showing the last 7 days for {email}</p>
            <p className="muted small">Runs are generated automatically around 9:00 AM and 9:00 PM ET each day.</p>
          </div>

          <div className="hero-actions">
            <button
              type="button"
              className="btn-primary compact"
              onClick={() => fetchRuns(userId)}
              disabled={!userId || refreshing}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>

        <section className="panel" id="results">
          <div className="results-head">
            <h2>Prediction history</h2>
            <span className="pill">{countLabel}</span>
          </div>

          {!refreshing && !hasResults && !error && <div className="empty-state">No results yet from the last 7 days.</div>}
          {error && <p className="error">{error}</p>}

          {hasResults && (
            <div className="timeline-wrap">
              <div className="timeline-row" ref={timelineRef}>
                {items.map((item, idx) => (
                  <Card key={`run-${idx}`} item={item} />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    )
  }

  function AppRoutes() {
    const location = useLocation()
    const navigate = useNavigate()

    useEffect(() => {
      if (!authChecked) return
      if (location.pathname === '/login' && session) navigate('/summaries', { replace: true })
    }, [authChecked, location.pathname, navigate, session])

    return (
      <Routes>
        <Route path="/" element={<Navigate to={session ? '/summaries' : '/login'} replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage onSession={setSession} onError={setError} />} />

        <Route
          path="/summaries"
          element={
            <RequireAuth session={session} authChecked={authChecked}>
              <SummariesPage />
            </RequireAuth>
          }
        />

        <Route
          path="/holdings"
          element={
            <RequireAuth session={session} authChecked={authChecked}>
              <HoldingsPage session={session} />
            </RequireAuth>
          }
        />

        <Route path="*" element={<Navigate to={session ? '/summaries' : '/login'} replace />} />
      </Routes>
    )
  }

  return (
    <BrowserRouter>
      <div className="navbar">
        <div className="navbar-inner">
          <div className="brand">Scorpio</div>

          {session ? (
            <div className="nav-links">
              <NavLink className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to="/summaries">
                Summaries
              </NavLink>
              <NavLink className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to="/holdings">
                Holdings
              </NavLink>
            </div>
          ) : null}

          {session ? (
            <button type="button" className="ghost compact nav-ghost" onClick={handleLogout}>
              Sign out
            </button>
          ) : null}
        </div>
      </div>

      <AppRoutes />
    </BrowserRouter>
  )
}
