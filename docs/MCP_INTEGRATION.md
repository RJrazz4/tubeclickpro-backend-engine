# MCP Integration

## Architectural role

MCP is used as an internal capability boundary. It does not magically reduce model latency; its value is a standard, auditable tool contract that avoids ad-hoc internal HTTP endpoints.

The Premium worker launches one local stdio MCP client and connects to the TubeClick Pro context server. Local stdio keeps extracted chunks off a public network route.

## Implemented tools

### `viral_dna_get_chunks`

Input:

```json
{ "jobId": "uuid", "userId": "authenticated-user-id" }
```

The server verifies that the requested job belongs to the user, then reads extracted chunks directly from Redis. The Micro-Critic uses this tool instead of receiving arbitrary client-provided transcript text.

### `viral_dna_get_channel_profile`

Input:

```json
{ "profileId": "uuid", "userId": "authenticated-user-id" }
```

The server performs an owner-scoped Supabase query and returns only synthesis-safe profile fields. It is the initial bridge between agent context and persistent channel DNA.

## Micro-Critic slice

The current implementation provides a deterministic baseline critic over the extracted 0–10 second transcript. It identifies basic hook signals and proves the MCP data path end to end. It deliberately does not pretend to be a production LLM critic.

The next vertical slice will introduce an allowlisted model gateway that:

1. obtains chunks and profile context through MCP;
2. supplies a strict structured-output schema;
3. applies token, latency, and cost limits;
4. rejects prompt-injected tool requests;
5. stores the audit and remediation notes;
6. never exposes arbitrary MCP tool selection to the frontend.

## External MCP servers

Internet-search MCP servers may be added only through an explicit server allowlist and tool allowlist. Configuration must pin the command/package version, cap output, enforce timeouts, and block arbitrary shell arguments. No user request may provide an MCP server command or tool name.

## Security properties

- Internal stdio transport only for the initial slice.
- Owner check inside each data-access tool.
- No public MCP endpoint.
- No arbitrary tool proxy.
- No secrets in tool output.
- Tool timeout enforced by the caller.
- Extracted context expires with the Redis job TTL.
