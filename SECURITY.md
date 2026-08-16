# Security policy

## Trust boundaries

- The frontend never selects or supplies its own tier. The backend derives tier from the authenticated Supabase subscription.
- Free and Premium jobs use separate BullMQ queues and independently deployable worker pools.
- The Python scraper accepts only HTTPS YouTube URLs, executes no shell, downloads no media, and does not attempt CAPTCHA bypass.
- MCP tools are internal, allowlisted, owner-scoped capabilities. Arbitrary MCP tool execution is not exposed over HTTP.
- Supabase service-role credentials and Redis credentials belong only in deployment secret stores.

## Secret handling

Never commit `.env`, Supabase keys, Redis credentials, YouTube API keys, TTS provider keys, cookies, proxy credentials, model keys, or browser sessions. The Docker build excludes `.env` files. Configure comma-separated `YOUTUBE_API_KEY` and `ELEVENLABS_API_KEY` pools, `FISH_AUDIO_API_KEY`, and private self-hosted TTS credentials only through the deployment secret store; keyed URLs, key values, and authorization headers are never logged. Use only credentials you are authorized to operate and follow provider quota/account policies.

If a secret is committed, rotate it immediately; deleting the latest file does not remove it from Git history.

## Responsible extraction

Use the engine only for content the operator is authorized to analyze. Respect platform terms, copyright, privacy, regional law, and rate limits. A challenge response is detected and surfaced as an error; the worker does not bypass it.

## Reporting

Report vulnerabilities privately to the repository owner. Do not open a public issue containing credentials, exploit details, or user data.
