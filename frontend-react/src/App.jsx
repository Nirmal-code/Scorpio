import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './utils/supabase'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, NavLink } from 'react-router-dom'
import HoldingsPage from './HoldingsPage'

const RUN_API_BASE = import.meta.env.VITE_RUN_API_BASE || 'http://165.227.39.159:9000'
const MCP_CLIENT_BEARER =
  import.meta.env.VITE_MCP_CLIENT_BEARER ||
  (typeof window !== 'undefined' ? window.__MCP_CLIENT_BEARER__ : '')

const TZ = 'America/New_York'

const formatMs = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  const s = String(totalSeconds % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

const getOffsetMinutes = (timeZone = TZ) => {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const tzName = fmt.formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || 'GMT'
  const match = tzName.match(/GMT([+-])(\d{2}):(\d{2})/)
  if (!match) return 0
  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3])
  return sign * (hours * 60 + minutes)
}

const getTzParts = (date, timeZone = TZ) => {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = fmt.formatToParts(date)
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

const buildSlot = (utcMs, label) => {
  const p = getTzParts(new Date(utcMs))
  return {
    id: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}-${label}`,
    time: utcMs,
    hour: Number(p.hour),
  }
}

const getNextSlotInfo = (now = new Date()) => {
  const offsetMin = getOffsetMinutes()
  const parts = getTzParts(now)
  const baseUtcToday = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0) - offsetMin * 60 * 1000

  const slots = [
    buildSlot(baseUtcToday - 3 * 60 * 60 * 1000, '21'), // yesterday 9pm
    buildSlot(baseUtcToday + 9 * 60 * 60 * 1000, '09'), // today 9am
    buildSlot(baseUtcToday + 21 * 60 * 60 * 1000, '21'), // today 9pm
    buildSlot(baseUtcToday + (24 + 9) * 60 * 60 * 1000, '09'), // tomorrow 9am
    buildSlot(baseUtcToday + (24 + 21) * 60 * 60 * 1000, '21'), // tomorrow 9pm
  ]

  const nowMs = now.getTime()
  let prevSlot = null
  let nextSlot = null
  for (const slot of slots) {
    if (slot.time <= nowMs && (!prevSlot || slot.time > prevSlot.time)) prevSlot = slot
    if (slot.time > nowMs && (!nextSlot || slot.time < nextSlot.time)) nextSlot = slot
  }

  return {
    prevSlot,
    nextSlot,
    remainingMs: nextSlot ? nextSlot.time - nowMs : 0,
    nextLabel: nextSlot ? (nextSlot.hour === 9 ? '9:00 AM ET' : '9:00 PM ET') : '',
  }
}

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

function AuthCallbackPage({ setError, setAuthBusy, setSession, setAuthChecked }) {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    let cancelled = false

    const completeAuth = async () => {
      try {
        setError('')
        setAuthBusy(true)

        const params = new URLSearchParams(location.search)
        const code = params.get('code')
        const err = params.get('error_description') || params.get('error')
        if (err) throw new Error(err)

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) throw error
        }

        const { data, error } = await supabase.auth.getSession()
        if (error) throw error

        const newSession = data?.session ?? null
        if (!newSession) {
          throw new Error('Login completed but no session was created. Check Supabase Auth settings + redirect URLs.')
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

  const [authChecked, setAuthChecked] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)

  const [session, setSession] = useState(null)
  const [userExists, setUserExists] = useState(null)
  const [userId, setUserId] = useState(null)

  const [jobStatus, setJobStatus] = useState('')
  const twelveHoursMs = 12 * 60 * 60 * 1000
  const [nextRunMs, setNextRunMs] = useState(twelveHoursMs)
  const [nextSlotLabel, setNextSlotLabel] = useState('9:00 AM / 9:00 PM ET')
  const [lastTriggeredSlot, setLastTriggeredSlot] = useState(null)
  const lastTriggeredRef = useRef(null)
  const jobStatusRef = useRef('')

  // Ensure a public "users" row exists for the signed-in email (creates on first sign-up).
  const ensureUserRow = async (email) => {
    if (!email) return null

    const { data: existing, error: selectErr } = await supabase
      .from('users')
      .select('id')
      .eq('wealthsimple_email', email)
      .maybeSingle()

    if (selectErr) throw selectErr
    if (existing?.id) return existing.id

    // Generate a reasonably unique bigint-like id (ms + random) for new users.
    const generatedId = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000))

    const { data: created, error: upsertErr } = await supabase
      .from('users')
      .upsert({ id: generatedId.toString(), wealthsimple_email: email })
      .select('id')
      .maybeSingle()

    if (upsertErr) throw upsertErr
    return created?.id ?? null
  }

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
      const ensuredUserId = await ensureUserRow(authedEmail)

      if (!ensuredUserId) {
        setUserExists(false)
        throw new Error('No user found for that email')
      }

      setUserExists(true)
      setUserId(ensuredUserId)

      const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const { data: runs, error: runsErr } = await supabase
        .from('runs')
        .select('summary, created_at')
        .eq('user_id', ensuredUserId)
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
        let text = ''
        try {
          const json = await res.json()
          text = json.detail || json.message || JSON.stringify(json)
          if (String(text).toLowerCase().includes('not found')) {
            setJobStatus('done')
            return 'done'
          }
        } catch (_) {
          text = await res.text()
        }
        throw new Error(`Status check failed (${res.status}): ${text}`)
      }
      const data = await res.json()
      const status = data.status || data.state
      setJobStatus(status || '')
      jobStatusRef.current = status || ''
      if (status && status.toLowerCase() !== 'running') return status
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }

  const handleLogout = async () => {
    console.log('Logging out')
    try {
      setLoading(true)
      await supabase.auth.signOut()
      setItems([])
      setSession(null)
    } finally {
      setLoading(false)
    }
  }

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

  const handleGoogleSignup = async () => {
    try {
      setError('')
      setAuthBusy(true)
      localStorage.setItem('signup_intent', '1')
      const redirectTo = `${window.location.origin}/auth/callback`
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      })
      
      if (error) throw error
    } catch (e) {
      setError(e?.message || 'Could not start Google sign-up.')
      setAuthBusy(false)
    }
  }

  useEffect(() => {
    let mounted = true

    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (!mounted) return
        if (error) setError(error.message)
        const sess = data?.session ?? null
        setSession(sess)
        setUserExists(null)
        if (sess?.user?.email) {
          await ensureUserRow(sess.user.email)
        }
      } catch (e) {
        if (mounted) setError(e?.message || 'Could not check session')
      } finally {
        if (mounted) setAuthChecked(true)
      }
    }

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) return
      setSession(newSession ?? null)
      setUserExists(null)
      if (newSession?.user?.email) {
        try {
          await ensureUserRow(newSession.user.email)
        } catch (e) {
          setError(e?.message || 'Could not create user row')
        }
      }
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
      setLastTriggeredSlot(null)
      lastTriggeredRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.email])

  useEffect(() => {
    if (!session?.user?.email) {
      setLastTriggeredSlot(null)
      lastTriggeredRef.current = null
      return
    }

    // If the user just signed up, create their row immediately.
    const signupIntent = localStorage.getItem('signup_intent')
    if (signupIntent === '1') {
      ensureUserRow(session.user.email)
        .then(() => {
          localStorage.removeItem('signup_intent')
        })
        .catch(() => {
          // swallow; fetchRuns will surface errors if needed
        })
    }

    const slotKey = `last_run_slot_${session.user.email}`
    const stored = localStorage.getItem(slotKey)
    if (stored) setLastTriggeredSlot(stored)
    if (stored) lastTriggeredRef.current = stored
  }, [session?.user?.email])

  const LoginPage = () => (
    <main className="page auth-container">
      <div className="auth-hero">
        <p className="eyebrow">Scorpio · portfolio intelligence</p>
        <h1>Enter the den.</h1>
        <p className="sub">Your AI-generated run summaries, all in one place. Sign in with Google to continue.</p>
        <div className="glow"></div>
      </div>
      <div className="panel auth-panel">
        <h2>Welcome back</h2>
        <p className="muted small">Use your Google account to access your portfolio summaries.</p>
        <div className="auth-actions">
          <button type="button" className="btn-primary full" onClick={handleGoogleLogin} disabled={authBusy}>
            {authBusy ? 'Opening Google…' : 'Continue with Google'}
          </button>
          <button type="button" className="ghost full" onClick={handleGoogleSignup} disabled={authBusy}>
            {authBusy ? 'Opening Google…' : 'Sign up with Google'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <p className="notice">Private access only. Outside users are not permitted.</p>
      </div>
    </main>
  )

  const SummariesPage = () => {
    if (!session) return <Navigate to="/login" replace />
    if (userExists === false) return <Navigate to="/login" replace />

    useEffect(() => {
      let timer
      let triggering = false

      const tick = async () => {
        if (!session?.user?.email || userExists === false) {
          setNextRunMs(twelveHoursMs)
          setNextSlotLabel('9:00 AM / 9:00 PM ET')
          setLastTriggeredSlot(null)
          lastTriggeredRef.current = null
          return
        }

        const slotKey = `last_run_slot_${session.user.email}`
        const storedLast = localStorage.getItem(slotKey)
        const lastId = lastTriggeredRef.current || lastTriggeredSlot || storedLast || null
        const { prevSlot, nextSlot, remainingMs, nextLabel } = getNextSlotInfo()
        setNextRunMs(remainingMs)
        setNextSlotLabel(nextLabel || '9:00 AM / 9:00 PM ET')

        if (prevSlot && !triggering && jobStatusRef.current !== 'running') {
          const nowMs = Date.now()
          const withinWindow = nowMs - prevSlot.time < 6 * 60 * 60 * 1000
          if (lastId !== prevSlot.id && withinWindow) {
            triggering = true
            setJobStatus('running')
            jobStatusRef.current = 'running'
            try {
              const runId = await triggerRemoteRun(session.user.email)
              await pollRunStatus(runId)
              localStorage.setItem(slotKey, prevSlot.id)
              setLastTriggeredSlot(prevSlot.id)
              lastTriggeredRef.current = prevSlot.id
              await fetchRuns()
            } catch (e) {
              setError(e?.message || 'Could not trigger scheduled run.')
            } finally {
              setJobStatus('')
              jobStatusRef.current = ''
              triggering = false
            }
          }
        }

        if (!prevSlot && remainingMs <= 0 && !triggering && jobStatusRef.current !== 'running') {
          triggering = true
          setJobStatus('running')
          jobStatusRef.current = 'running'
          try {
            const runId = await triggerRemoteRun(session.user.email)
            await pollRunStatus(runId)
            if (nextSlot) {
              localStorage.setItem(slotKey, nextSlot.id)
              setLastTriggeredSlot(nextSlot.id)
              lastTriggeredRef.current = nextSlot.id
            }
            await fetchRuns()
          } catch (e) {
            setError(e?.message || 'Could not trigger scheduled run.')
          } finally {
            setJobStatus('')
            jobStatusRef.current = ''
            triggering = false
          }
        }
      }

      tick()
      timer = setInterval(tick, 60000)
      return () => {
        if (timer) clearInterval(timer)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session?.user?.email, userExists, lastTriggeredSlot])

    return (
      <div className="page">
        <header className="hero">
          <div>
            <p className="eyebrow">Scorpio · portfolio insights</p>
            <h1>Run summaries</h1>
            <p className="sub">Showing the last 7 days for {session.user.email}</p>
          </div>
        </header>

        <section className="panel" id="results">
          <div className="results-head">
            <h2>Prediction history</h2>
            <span className="pill">{countLabel}</span>
          </div>

          {jobStatus && <div className="info">Job status: {jobStatus}</div>}

          {session?.user?.email && (
            <div className="muted">
              Next auto-refresh (~9am/9pm ET) in {formatMs(nextRunMs)}
              {nextSlotLabel ? ` · Upcoming slot: ${nextSlotLabel}` : ''}
            </div>
          )}

          {loading && <div className="empty-state">Loading…</div>}
          {!loading && !hasResults && !error && <div className="empty-state">No results yet from the last 7 days.</div>}
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
      if (location.pathname.startsWith('/auth/callback')) return
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

          {session ? (
            <div className="nav-right">
              <div className="nav-links">
                <NavLink className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to="/summaries">
                  Summaries
                </NavLink>
                <NavLink className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to="/holdings">
                  Holdings
                </NavLink>
              </div>

              <button type="button" className="ghost compact nav-ghost" onClick={handleLogout}>
                Sign out
              </button>
            </div>
          ): null}

        </div>
      </div>

      <AppRoutes />
    </BrowserRouter>
  )
}
