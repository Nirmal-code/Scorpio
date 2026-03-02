import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './utils/supabase'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom'

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
      const { data: users, error: userErr } = await supabase
        .from('users')
        .select('id')
        .eq('wealthsimple_email', authedEmail)
        .limit(1)

      if (userErr) throw userErr
      if (!users || users.length === 0) throw new Error('No user found for that email')

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
    } catch (e) {
      setError(e?.message || 'Could not fetch history.')
      setItems([])
    } finally {
      setLoading(false)
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

  useEffect(() => {
    if (session?.user?.email) fetchRuns()
    else setItems([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.email])

  const LoginPage = () => (
    <main className="page auth-container">
      <div className="panel auth-panel">
        <h1>Welcome back</h1>
        <p className="sub">Sign in with Google to view your portfolio run summaries.</p>
        <button type="button" onClick={handleGoogleLogin} disabled={authBusy}>
          {authBusy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {error && <p className="error">{error}</p>}
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

    return (
      <div className="page">
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
      <AppRoutes />
    </BrowserRouter>
  )
}