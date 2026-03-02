import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './utils/supabase'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import HoldingsPage from './HoldingsPage'

const RUN_API_BASE = import.meta.env.VITE_RUN_API_BASE || 'http://165.227.39.159:9000'
const MCP_CLIENT_BEARER =
  import.meta.env.VITE_MCP_CLIENT_BEARER ||
  (typeof window !== 'undefined' ? window.__MCP_CLIENT_BEARER__ : '')

function Card({ item }) {
  return (
    <article className="card">
      <header>
        <div>
          <p className="meta date-top">{item.date || ''}</p>
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
        <span className="meta">{item.source || 'model'}</span>
      </footer>
    </article>
  )
}

/**
 * Robust OAuth callback handler:
 * - Handles PKCE `?code=...`
 * - Also works if provider returns tokens in the hash
 * - Waits for Supabase to persist the session, then navigates
 */
function AuthCallbackPage({ setError, setAuthBusy, setSession, setAuthChecked }) {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    let cancelled = false

    const completeAuth = async () => {
      try {
        setError('')
        setAuthBusy(true)

        // If Supabase already detected session from URL (hash flow), it may already be stored.
        // If PKCE code exists, exchange it.
        const params = new URLSearchParams(location.search)
        const code = params.get('code')
        const err = params.get('error_description') || params.get('error')
        if (err) throw new Error(err)

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) throw error
        }

        // Now read the session that should be persisted by Supabase.
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error

        const newSession = data?.session ?? null
        if (!newSession) {
          throw new Error(
            'Login completed but no session was created. Check Supabase Auth settings + redirect URLs.'
          )
        }

        if (!cancelled) {
          setSession(newSession)
          setAuthChecked(true)
          navigate('/summaries', { replace: true })
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Could not complete sign-in.')
          setAuthChecked(true)
          navigate('/login', { replace: true })
        }
      } finally {
        if (!cancelled) setAuthBusy(false)
      }
    }

    completeAuth()
    return () => {
      cancelled = true
    }
  }, [location.search, navigate, setAuthBusy, setError, setSession, setAuthChecked])

  return (
    <main className="page auth-container">
      <div className="panel auth-panel">
        <h1>Signing you in…</h1>
        <p className="sub">Completing Google sign-in.</p>
      </div>
    </main>
  )
}

export default function App() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // authChecked prevents redirect loops: only enforce routes after first getSession completes
  const [authChecked, setAuthChecked] = useState(false)

  // authBusy is ONLY for disabling login button/spinner while launching oauth or exchanging code
  const [authBusy, setAuthBusy] = useState(false)

  const [session, setSession] = useState(null)
  const [userExists, setUserExists] = useState(null)
  const [userId, setUserId] = useState(null)
  const [jobStatus, setJobStatus] = useState('')

  const hasResults = items && items.length > 0
  const countLabel = useMemo(() => (hasResults ? items.length : 0), [items, hasResults])

  const fetchRuns = async () => {
    setError('')
    const authedEmail = session?.user?.email || ''
    if (!authedEmail) {
      setError('Please sign in with Google to fetch your history.')
      return
    }

    setLoading(true)
    try {
      const { data: userRow, error: userErr } = await supabase
        .from('users')
        .select('id')
        .eq('wealthsimple_email', authedEmail)
        .maybeSingle()

      if (userErr) throw userErr
      if (!userRow) {
        setUserExists(false)
        throw new Error('No user found for that email')
      }
      setUserExists(true)
      setUserId(userRow.id)

      const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const { data: runs, error: runsErr } = await supabase
        .from('runs')
        .select('summary, created_at')
        .eq('user_id', userRow.id)
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
      setItems([])
      // If user lookup failed, force logout and send back to login
      if (e?.message?.includes('No user found')) {
        await supabase.auth.signOut()
        setSession(null)
      }
    } finally {
      setLoading(false)
    }
  }

  const triggerRemoteRun = async (authedEmail) => {
    if (!MCP_CLIENT_BEARER) {
      throw new Error(
        'Missing MCP client bearer. Set VITE_MCP_CLIENT_BEARER at build time (or window.__MCP_CLIENT_BEARER__ at runtime).'
      )
    }
    const url = `${RUN_API_BASE.replace(/\/$/, '')}/run`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MCP_CLIENT_BEARER}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: authedEmail }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Run trigger failed (${res.status}): ${text}`)
    }
    const data = await res.json()
    const runId = data.id || data.run_id || data.job_id
    if (!runId) throw new Error('Run trigger did not return an id')
    return runId
  }

  const pollRunStatus = async (runId) => {
    const statusUrl = `${RUN_API_BASE.replace(/\/$/, '')}/run/${runId}`
    while (true) {
      const res = await fetch(statusUrl, {
        headers: { Authorization: `Bearer ${MCP_CLIENT_BEARER}` },
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Status check failed (${res.status}): ${text}`)
      }
      const data = await res.json()
      const status = data.status || data.state
      setJobStatus(status || '')
      if (status && status.toLowerCase() !== 'running') {
        return status
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }

  const handleRefreshJob = async () => {
    setError('')
    setJobStatus('running')
    const authedEmail = session?.user?.email || ''
    if (!authedEmail) {
      setError('Please sign in with Google to fetch your history.')
      setJobStatus('')
      return
    }
    setLoading(true)
    try {
      const runId = await triggerRemoteRun(authedEmail)
      await pollRunStatus(runId)
      await fetchRuns()
    } catch (e) {
      setError(e?.message || 'Could not trigger run.')
    } finally {
      setLoading(false)
      setJobStatus('')
    }
  }

  const handleLogout = async () => {
    setLoading(true)
    await supabase.auth.signOut()
    setItems([])
    setSession(null)
    setLoading(false)
  }

  const handleGoogleLogin = async () => {
    try {
      setError('')
      setAuthBusy(true)

      // Don’t rely on VITE_SITE_URL unless you’re 100% sure it matches prod origin.
      // Using window.location.origin avoids a VERY common redirect mismatch bug.
      const redirectTo = `${window.location.origin}/auth/callback`

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      })
      if (error) throw error
      // Supabase will redirect the browser to Google, then back to /auth/callback.
    } catch (e) {
      setError(e?.message || 'Could not start Google sign-in.')
      setAuthBusy(false)
    }
  }

  // Initial auth bootstrap + subscription
  useEffect(() => {
    let mounted = true

    const init = async () => {
    try {
      const { data, error } = await supabase.auth.getSession()
      if (!mounted) return
      if (error) setError(error.message)
      setSession(data?.session ?? null)
      setUserExists(null) // unknown until we check
    } catch (e) {
      if (mounted) setError(e?.message || 'Could not check session')
    } finally {
      if (mounted) setAuthChecked(true)
    }
    }

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return
      setSession(newSession ?? null)
      setUserExists(null) // reset until verified
    })

    init()

    return () => {
      mounted = false
      listener?.subscription?.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (session?.user?.email) fetchRuns()
    else {
      setItems([])
      setUserExists(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.email])

  const LoginPage = () => (
    <main className="page auth-container">
      <div className="auth-hero">
        <p className="eyebrow">Scorpio · portfolio intelligence</p>
        <h1>Enter the den.</h1>
        <p className="sub">
          Your AI-generated run summaries, all in one place. Sign in with Google to continue.
        </p>
        <div className="glow"></div>
      </div>
      <div className="panel auth-panel">
        <h2>Sign in</h2>
        <button type="button" className="btn-primary full" onClick={handleGoogleLogin} disabled={authBusy}>
          {authBusy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {error && <p className="error">{error}</p>}
        <p className="notice">Note: private access only. Outside users are not permitted at this time.</p>
      </div>
    </main>
  )

  const SummariesPage = () => {
    if (!authChecked) {
      return (
        <main className="page">
          <div className="empty-state">Checking session…</div>
        </main>
      )
    }
    if (!session) return <Navigate to="/login" replace />
    if (userExists === false) return <Navigate to="/login" replace />

    return (
      <div className="page">
        <header className="hero">
          <div>
            <p className="eyebrow">Scorpio · portfolio insights</p>
            <h1>Run summaries</h1>
            <p className="sub">Showing the last 7 days for {session.user.email}</p>
          </div>
            <div className="hero-actions">
              <button type="button" className="btn-primary compact" onClick={handleRefreshJob} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button type="button" className="ghost compact" onClick={handleLogout} disabled={loading}>
                Sign out
              </button>
            </div>
        </header>

        <section className="panel" id="results">
          <div className="results-head">
            <h2>Prediction history</h2>
            <span className="pill">{countLabel}</span>
          </div>
          {jobStatus && <div className="info">Job status: {jobStatus}</div>}

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
      </div>
    )
  }

  const AppRoutes = () => {
    const location = useLocation()
    const navigate = useNavigate()

    useEffect(() => {
      // Never redirect while callback route is processing.
      if (location.pathname.startsWith('/auth/callback')) return

      // Don’t enforce auth redirects until the initial auth check finishes.
      if (!authChecked) return

      if (session && location.pathname === '/login') {
        navigate('/summaries', { replace: true })
      } else if (!session && location.pathname !== '/login') {
        navigate('/login', { replace: true })
      }
    }, [authChecked, session, location.pathname, navigate])

    return (
      <Routes>
        <Route path="/" element={<Navigate to={session ? '/summaries' : '/login'} replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/summaries" element={<SummariesPage />} />
        <Route
          path="/holdings"
          element={
            !authChecked ? (
              <main className="page">
                <div className="empty-state">Checking session…</div>
              </main>
            ) : session && userExists !== false ? (
              <HoldingsPage
                session={session}
                onNoUser={async () => {
                  await supabase.auth.signOut()
                  setSession(null)
                  setUserExists(false)
                }}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/auth/callback"
          element={
            <AuthCallbackPage
              setError={setError}
              setAuthBusy={setAuthBusy}
              setSession={setSession}
              setAuthChecked={setAuthChecked}
            />
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
          <div className="nav-links">
            <a
              className={`nav-link ${window.location.pathname === '/summaries' ? 'active' : ''}`}
              href="/summaries"
            >
              Summaries
            </a>
            <a
              className={`nav-link ${window.location.pathname === '/holdings' ? 'active' : ''}`}
              href="/holdings"
            >
              Holdings
            </a>
          </div>
        </div>
      </div>
      <AppRoutes />
    </BrowserRouter>
  )
}
