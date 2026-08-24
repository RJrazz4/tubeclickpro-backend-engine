# Google OAuth Setup — "Connect YouTube" (Module O)

Step-by-step configuration for the YouTube Signal Link. Do this **before**
deploying the code; the module stays disabled (503 on its routes) until
`GOOGLE_OAUTH_CLIENT_ID` + friends are set.

---

## ⚠️ The two launch traps (read first)

1. **The 7-day refresh-token trap.** While the OAuth consent screen is in
   *Testing* status, Google issues refresh tokens that **expire after 7 days**
   and caps you at 100 test users. **Push the app to Production status on day
   one** (unverified is allowed; you get long-lived refresh tokens). Submit
   for verification before public launch to remove the "unverified app"
   warning screen.
2. **The trust mandate.** The frontend button MUST read **"Connect YouTube"**
   (or "Login with YouTube") — never "Sign in with Google". For that to feel
   true, the Google consent screen itself must be branded **"TubeClick Pro"**
   so creators see one consistent name at every step.

---

## 1. Google Cloud project

1. Create (or pick) a project at console.cloud.google.com.
2. **APIs & Services → Library** → enable:
   - **YouTube Data API v3**
   - **YouTube Analytics API**
3. **APIs & Services → OAuth consent screen** (External):
   - App name: `TubeClick Pro` · support email: yours
   - App homepage: `https://tubeclickpro.in` · privacy policy: a real URL
     (required later for verification) · logo
   - **Scopes:** add exactly the two read-only scopes —
     `.../auth/yt-analytics.readonly`, `.../auth/youtube.readonly`.
     Do NOT request upload/manage scopes — minimization keeps verification
     simple and creators calm.
   - Test users: add your own Google accounts while in Testing.
4. **Publish the app** (Production) once the connect flow works end-to-end.

## 2. OAuth client

1. **Credentials → Create credentials → OAuth client ID → Web application.**
2. Authorized redirect URI (exact match, HTTPS):
   `https://<your-engine-host>/api/youtube/callback`
   (Render example: `https://tubeclickpro-engine.onrender.com/api/youtube/callback`)
3. Copy the Client ID and Client secret → Render env vars.

## 3. Engine environment (Render)

| Variable | Value |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | from step 2 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | from step 2 |
| `GOOGLE_OAUTH_REDIRECT_URL` | the exact URI from step 2 |
| `YOUTUBE_TOKEN_MASTER_KEY` | ≥16 random chars (`openssl rand -base64 32`) — AES-256-GCM vault key |

Leave these unset only in environments where you intentionally want the
module off (routes then return `503 YOUTUBE_MODULE_DISABLED`).

### Rotating the master key
1. Set both old and new keys (deploy supports one at a time — do a maintenance window).
2. Read each `youtube_connections.refresh_enc`, decrypt with the old key,
   re-encrypt with the new, update the row. (A one-off script; keep it out of git.)
3. Alternatively: ask users to re-connect (fastest, zero crypto in scripts).

## 4. Supabase

Run the two migrations in the SQL editor, in order:
`202608240001_youtube_signal_link.sql` → `202608240002_analytics_raw_tables.sql`
(both idempotent). No RPCs are exposed to anon/authenticated — the hardening
is built in.

## 5. Frontend contract

```ts
// Button label: "Connect YouTube"
const { authUrl } = await fetch(`${ENGINE}/api/youtube/auth-url`, {
  headers: { Authorization: `Bearer ${supabaseAccessToken}` },
}).then(r => r.json());
window.location.href = authUrl;   // → Google → back to /settings?youtube=connected
```

Status card: `GET /api/youtube/connection` · Disconnect: `DELETE` same path ·
On-demand re-sync (Pro): `POST /api/youtube/sync`.

## 6. Verification checklist (before public launch)

- [ ] Consent screen shows "TubeClick Pro" + only the 2 read-only scopes
- [ ] App in **Production** status (refresh tokens live beyond 7 days)
- [ ] Connect → 90-day backfill completes (`youtube_sync_state.phase='idle'`)
- [ ] Disconnect revokes at Google (check myaccount.google.com/permissions)
- [ ] Raw reports pruned after 30 days (`prune_youtube_raw` in maintenance job)
- [ ] Verification submission filed (removes the unverified warning; the
      yt-analytics.readonly scope requires a Loom/screenshot demo — show the
      connect flow and the analytics read-only usage)
