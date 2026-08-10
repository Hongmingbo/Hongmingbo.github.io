# Music BFF Contract

> Scope: the static Astro blog's `MusicDock` talks only to this trusted HTTPS backend.
> The backend, not the browser, owns all KuGou/MoeKoe upstream tokens, cookies, device identifiers and protocol details.

## Security invariants

- Allow exactly the blog origin: `https://hmb2011.bond`.
- The public MusicDock bundle uses the fixed production BFF origin `https://music.hmb2011.bond`; it does not accept a visitor-provided credentialed API origin. Only development builds may override the endpoint through `PUBLIC_MUSIC_DEV_API_URL`.
- No wildcard CORS when credentials are enabled.
- Browser authentication is an opaque BFF session in a browser-managed **HttpOnly cookie**. The production frontend `hmb2011.bond` and BFF `music.hmb2011.bond` are same-site HTTPS origins, so production uses a host-only `__Host-music_session` cookie with `Secure; HttpOnly; SameSite=Lax; Path=/` and no `Domain` or `Partitioned` attribute. Local development uses a separate `music_session` cookie with `HttpOnly; SameSite=Lax` and must use the same loopback host (`127.0.0.1` or `localhost`) for both blog preview and BFF. The browser never receives or stores the session value, upstream token, `t1`, `vip_token`, raw cookie, or device identifier.
- The audio element uses a credentialed BFF-hosted stream route; the BFF proxies media bytes and never exposes the upstream media URL to page state.
- Never return upstream `token`, `t1`, `vip_token`, raw cookies, device IDs, or signature material to the browser.
- Set `Cache-Control: private, no-store` on every route below except a public health check.
- Redact request query/body fields from logs for authentication, QR, song stream, lyric and VIP routes.
- Rate limit login/SMS/QR polling; expire incomplete QR sessions.
- The upstream KuGouMusicApi must remain backend-private. Do not expose it publicly through the blog origin.

## Response envelope

Successful replies use the existing client-compatible shape:

```json
{ "status": 1, "data": {} }
```

Failures use a non-2xx status where appropriate and may include:

```json
{ "status": 0, "error_code": "SESSION_EXPIRED", "message": "..." }
```

## Browser-facing endpoints

| Method | Path | Browser-safe response | Backend responsibility |
| --- | --- | --- | --- |
| `GET` | `/health` | `{ status: 1, data: { ready: true } }` | liveness/readiness only |
| `GET` | `/session` | `{ authenticated, userid, nickname, pic }` | read opaque HttpOnly BFF cookie; never emit upstream token |
| `POST` | `/session/logout` | empty success | delete server session, expire the HttpOnly BFF cookie, and clear upstream state |
| `POST` | `/auth/password` | safe profile only | exchange account/password upstream; set opaque HttpOnly BFF cookie |
| `POST` | `/auth/sms/send` | delivery acknowledgement | proxy SMS request with rate limiting |
| `POST` | `/auth/sms/login` | safe profile only | exchange phone/code upstream; set opaque HttpOnly BFF cookie |
| `POST` | `/auth/qr` | `{ key, image }` | create server-bound QR challenge |
| `GET` | `/auth/qr/status?key=` | `{ status: 0\|2\|4 }` | poll server-bound QR challenge; on success set opaque HttpOnly BFF cookie |
| `GET` | `/playlists` | playlist metadata | use server-held account session |
| `GET` | `/playlists/:id/tracks` | track metadata | use server-held account session |
| `GET` | `/tracks/:hash/stream` | BFF-proxied audio bytes | browser `Audio` sends the HttpOnly BFF cookie; BFF proxies media bytes and never returns the upstream media URL |
| `GET` | `/tracks/:hash/lyrics` | `{ content }` | resolve/decode upstream lyrics server-side |
| `POST` | `/vip/daily` | claim status | use Asia/Shanghai date; retain transient failures retryable |
| `POST` | `/vip/daily/upgrade` | upgrade status | use server-held account session |

## Daily VIP state machine

1. On a verified browser session, the client asks `POST /vip/daily` with `receive_day` in `Asia/Shanghai`.
2. A successful claim, or upstream `131001` (already claimed), is treated as complete for that date.
3. Only after a successful claim does the client ask `POST /vip/daily/upgrade`.
4. A temporary failure must **not** write the local completion marker; first playback may retry it.
5. Upstream `20028` is surfaced as “complete verification in the official KuGou client”; do not bypass it.

## Local test adapter

A local Mock BFF may use `http://127.0.0.1` only in development builds through `PUBLIC_MUSIC_DEV_API_URL`.
It must never be compiled into a production build, and it must not be used with real account data.
