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
    buildSlot(baseUtcToday - 3 * 60 * 60 * 1000, '21'),
    buildSlot(baseUtcToday + 9 * 60 * 60 * 1000, '09'),
    buildSlot(baseUtcToday + 21 * 60 * 60 * 1000, '21'),
    buildSlot(baseUtcToday + (24 + 9) * 60 * 60 * 1000, '09'),
    buildSlot(baseUtcToday + (24 + 21) * 60 * 60 * 1000, '21'),
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

  const [jobStatus, setJobStatus] = useState('')
  const twelveHoursMs = 12 * 60 * 60 * 1000
  const [nextRunMs, setNextRunMs] = useState(twelveHoursMs)
  const [nextSlotLabel, setNextSlotLabel] = useState('9:00 AM / 9:00 PM ET')

  const lastTriggeredRef = useRef(null)
  const jobStatusRef = useRef('')

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

  // When session changes: compute userId and load last run slot.
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setError('')
      setItems([])
      setUserId(null)
      lastTriggeredRef.current = null

      const email = session?.user?.email
      if (!email) return

      try {
        const uid = await ensureUserRow(email)
        if (cancelled) return
        setUserId(uid)

        const slotKey = `last_run_slot_${email}`
        lastTriggeredRef.current = localStorage.getItem(slotKey)
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

  const triggerRemoteRun = async (email) => {
    if (!MCP_CLIENT_BEARER) throw new Error('Missing MCP bearer (VITE_MCP_CLIENT_BEARER).')
    const url = `${RUN_API_BASE.replace(/\/$/, '')}/run`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MCP_CLIENT_BEARER}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    })
    if (!res.ok) throw new Error(`Run trigger failed (${res.status}): ${await res.text()}`)
    const data = await res.json()
    const runId = data.id || data.run_id || data.job_id
    if (!runId) throw new Error('Run trigger did not return an id')
    return runId
  }

  const pollRunStatus = async (runId) => {
    const statusUrl = `${RUN_API_BASE.replace(/\/$/, '')}/run/${runId}`
    while (true) {
      const res = await fetch(statusUrl, { headers: { Authorization: `Bearer ${MCP_CLIENT_BEARER}` } })
      if (!res.ok) throw new Error(`Status check failed (${res.status}): ${await res.text()}`)
      const data = await res.json()
      const status = data.status || data.state || ''
      setJobStatus(status)
      jobStatusRef.current = status
      if (status && status.toLowerCase() !== 'running') return status
      await new Promise((r) => setTimeout(r, 2000))
    }
  }

  function LoginPage() {
    return (
      <main className="page auth-container">
        <div className="auth-hero">
          <p className="eyebrow">Scorpio · portfolio intelligence</p>
          <h1>Enter the den.</h1>
          <p className="sub">Sign in with Google to continue.</p>
          <div className="glow"></div>
        </div>
        <div className="panel auth-panel">
          <h2>Sign in</h2>
          <button type="button" className="btn-primary full" onClick={handleGoogleLogin} disabled={authBusy}>
            {authBusy ? 'Opening Google…' : 'Continue with Google'}
          </button>
          {error && <p className="error">{error}</p>}
          <p className="notice">Private access only.</p>
        </div>
      </main>
    )
  }

  function SummariesPage() {
    const email = session?.user?.email

    // Stable auto-run timer: only depends on email/userId, not on changing slot state.
    useEffect(() => {
      if (!email) return

      const slotKey = `last_run_slot_${email}`
      lastTriggeredRef.current = localStorage.getItem(slotKey)

      let timer = null
      let triggering = false

      const tick = async () => {
        const { prevSlot, remainingMs, nextLabel } = getNextSlotInfo()
        setNextRunMs(remainingMs)
        setNextSlotLabel(nextLabel || '9:00 AM / 9:00 PM ET')

        if (!prevSlot) return
        if (triggering) return
        if ((jobStatusRef.current || '').toLowerCase() === 'running') return

        const lastId = lastTriggeredRef.current || localStorage.getItem(slotKey)
        const nowMs = Date.now()
        const withinWindow = nowMs - prevSlot.time < 6 * 60 * 60 * 1000

        if (withinWindow && lastId !== prevSlot.id) {
          triggering = true
          setJobStatus('running')
          jobStatusRef.current = 'running'
          try {
            const runId = await triggerRemoteRun(email)
            await pollRunStatus(runId)
            localStorage.setItem(slotKey, prevSlot.id)
            lastTriggeredRef.current = prevSlot.id
            if (userId) await fetchRuns(userId)
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
    }, [email, userId])

    return (
      <div className="page">
        <header className="hero">
          <div>
            <p className="eyebrow">Scorpio · portfolio insights</p>
            <h1>Run summaries</h1>
            <p className="sub">Showing the last 7 days for {email}</p>
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

          {jobStatus && <div className="info">Job status: {jobStatus}</div>}

          {email && (
            <div className="muted">
              Next auto-run (~9am/9pm ET) in {formatMs(nextRunMs)}
              {nextSlotLabel ? ` · Upcoming slot: ${nextSlotLabel}` : ''}
            </div>
          )}

          {!refreshing && !hasResults && !error && <div className="empty-state">No results yet from the last 7 days.</div>}
          {error && <p className="error">{error}</p>}

          {hasResults && (
            <div className="timeline">
              {items.map((item, idx) => (
                <Card key={`run-${idx}`} item={item} />
              ))}
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

          <div className="nav-links">
            <NavLink className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to="/summaries">
              Summaries
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to="/holdings">
              Holdings
            </NavLink>
          </div>

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