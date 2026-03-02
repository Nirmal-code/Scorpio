# Scorpio React Frontend

A minimal React (Vite) UI that lets users enter their email and view all saved predictions.

## Quick start
```bash
cd frontend-react
npm install
npm run dev   # opens on http://localhost:5173
```

## Configure API
Set `VITE_API_BASE` to your backend base URL (default `http://localhost:8000`). Examples:
```bash
# one-off
VITE_API_BASE=https://api.yourdomain.com npm run dev

# or add to .env.local
VITE_API_BASE=https://api.yourdomain.com
```
Backend endpoint expected: `GET /history?email=you@example.com` returning JSON array:
```json
[
  {"ticker":"NET","title":"Hold","summary":"...","date":"2026-02-28","source":"model","tone":"neutral"}
]
```

## Build
```bash
npm run build
npm run preview   # serve dist/
```

## Deploy
- Static hosting (Netlify, Vercel, S3+CloudFront): deploy `dist/` after build.
- Set `VITE_API_BASE` as an env var in your host settings.
