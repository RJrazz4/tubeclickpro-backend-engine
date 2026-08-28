# Render Backend Setup Guide

## Required Environment Variables for Render Dashboard

Add ALL of these environment variables to your Render backend service (`tubeclickpro-backend-engine`) for full functionality:

### 🔴 **CRITICAL - Must Have (Backend will fail without these)**

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `NODE_ENV` | Environment mode | `production` |
| `SUPABASE_URL` | Your Supabase project URL | `https://your-project-ref.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase public anon key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (admin) key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `CORS_ORIGINS` | Allowed frontend origins (comma-separated) | `https://tubeclickpro.in,https://www.tubeclickpro.in,http://localhost:5173` |
| `REDIS_URL` | Redis connection URL | `redis://:password@host:port` |

### 🟡 **YouTube Module (Required for YouTube Connect feature)**

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth 2.0 Client ID | `1234567890-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com` |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth 2.0 Client Secret | `GOCSPX-abcdefghijklmnopqrstuvwxyz` |
| `GOOGLE_OAUTH_REDIRECT_URL` | OAuth callback URL | `https://tubeclickpro-backend-engine.onrender.com/api/youtube/callback` |
| `YOUTUBE_TOKEN_MASTER_KEY` | Encryption key for token storage (min 16 chars) | `your-32-char-encryption-key-here` |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key | `AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ` |

### 🟡 **AI & Voice Providers (Required for Neural Voice)**

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `ELEVENLABS_API_KEY` | ElevenLabs TTS API key | `sk_abcdef1234567890abcdef1234567890` |
| `OPENROUTER_API_KEYS` | OpenRouter API keys (comma-separated) | `sk-or-v1-key1,sk-or-v1-key2` |

### 🟢 **Optional but Recommended**

| Variable | Description | Example Value | Default |
|----------|-------------|---------------|---------|
| `PORT` | Server port | `3000` | `3000` |
| `HOST` | Bind address | `0.0.0.0` | `0.0.0.0` |
| `LOG_LEVEL` | Logging level | `info` | `info` |
| `AUTH_MODE` | Authentication mode | `supabase` | `supabase` |
| `SUPABASE_TIER_SOURCE` | Tier source method | `rpc` | `rpc` |
| `SUPABASE_TIER_RPC` | RPC function name | `get_ghost_tier_for` | `get_ghost_tier_for` |
| `YOUTUBE_API_TIMEOUT_MS` | YouTube API timeout | `10000` | `10000` |
| `YOUTUBE_DATA_API_DAILY_UNITS` | Daily API quota | `9000` | `9000` |

### 🔵 **Queue & Rate Limiting**

| Variable | Description | Example Value | Default |
|----------|-------------|---------------|---------|
| `FREE_WORKER_CONCURRENCY` | Free tier workers | `2` | `2` |
| `PREMIUM_WORKER_CONCURRENCY` | Premium tier workers | `10` | `10` |
| `FREE_QUEUE_RATE_MAX` | Free rate limit | `2` | `2` |
| `PREMIUM_QUEUE_RATE_MAX` | Premium rate limit | `20` | `20` |

## 📋 Setup Checklist

### 1. **Google OAuth Setup (for YouTube Connect)**
- [ ] Go to [Google Cloud Console](https://console.cloud.google.com/)
- [ ] Create a new project or select existing
- [ ] Enable "YouTube Data API v3"
- [ ] Create OAuth 2.0 credentials (Web application type)
- [ ] Add authorized redirect URI: `https://tubeclickpro-backend-engine.onrender.com/api/youtube/callback`
- [ ] Copy Client ID and Client Secret to Render env vars

### 2. **Supabase Setup**
- [ ] Get `SUPABASE_URL` from Project Settings > API
- [ ] Get `SUPABASE_ANON_KEY` from Project Settings > API
- [ ] Get `SUPABASE_SERVICE_ROLE_KEY` from Project Settings > API (under Service Role)

### 3. **Redis Setup**
- [ ] Create a Redis instance (Render Redis or external)
- [ ] Get connection URL in format: `redis://:password@host:port`
- [ ] Set as `REDIS_URL` in Render

### 4. **AI Provider Keys**
- [ ] Get ElevenLabs API key from [ElevenLabs](https://elevenlabs.io/)
- [ ] Get OpenRouter API keys from [OpenRouter](https://openrouter.ai/)
- [ ] Get YouTube Data API key from [Google Cloud](https://console.cloud.google.com/)

### 5. **CORS Configuration**
- [ ] Set `CORS_ORIGINS` to include all your frontend domains:
  ```
  https://tubeclickpro.in,https://www.tubeclickpro.in,http://localhost:5173
  ```

## 🚨 Common Issues & Fixes

### Issue: "Sign in to complete your Free Chain-Loop"
**Cause:** Supabase session token not being passed correctly or expired
**Fix:**
1. Ensure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are set
2. Check that user is actually signed in (session exists)
3. Verify CORS allows the frontend domain

### Issue: "Could not start YouTube connect. Is the engine configured?"
**Cause:** YouTube module not configured in backend
**Fix:**
1. Add all Google OAuth variables (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URL`)
2. Add `YOUTUBE_TOKEN_MASTER_KEY` (min 16 characters)
3. Ensure redirect URL matches exactly: `https://tubeclickpro-backend-engine.onrender.com/api/youtube/callback`

### Issue: Channel URL input freezes/hangs
**Cause:** Backend cold start or YouTube API timeout
**Fix:**
1. Wait 30-60 seconds for Render to wake up
2. Check `YOUTUBE_API_KEY` is valid and has quota
3. Verify `YOUTUBE_API_TIMEOUT_MS` is set (default 10000ms)

### Issue: 401/403 errors on API calls
**Cause:** Authentication token not accepted
**Fix:**
1. Verify `SUPABASE_URL` matches your Supabase project
2. Check `SUPABASE_ANON_KEY` is the public key (not service role)
3. Ensure `CORS_ORIGINS` includes your frontend domain
4. Check browser console for CORS errors

## 🔧 Testing Your Setup

### Test Supabase Connection
```bash
curl -X GET https://tubeclickpro-backend-engine.onrender.com/healthz
# Should return: {"status":"ok","service":"tubeclickpro-backend-engine"}
```

### Test Authentication
```bash
curl -X GET https://tubeclickpro-backend-engine.onrender.com/healthz \
  -H "Authorization: Bearer YOUR_SUPABASE_ACCESS_TOKEN"
```

### Test YouTube Module
```bash
# If configured, should return auth URL
curl -X GET https://tubeclickpro-backend-engine.onrender.com/api/youtube/auth-url \
  -H "Authorization: Bearer YOUR_SUPABASE_ACCESS_TOKEN"
```

## 📊 Environment Variable Priority

1. **Render Dashboard** > .env file > Default values
2. Always set critical variables in Render Dashboard (not just .env)
3. Render automatically injects dashboard env vars into the container

## 🎯 Production Recommendations

- Use Render's built-in Redis for `REDIS_URL`
- Set `NODE_ENV=production` 
- Enable auto-deploy on GitHub pushes
- Monitor logs for authentication errors
- Set up alerts for 4xx/5xx errors
