# mmar-sync-server

Real-time collaboration sync server for MMAR. Hosts one Yjs room per shared scene instance over WebSocket, with JWT auth and per-connection read/write gating.

## Running locally

```bash
cp .env.example .env   # adjust values as needed
npm install
npm run debug          # ts-node + nodemon, hot-reloads on src/ changes
```

Production build:

```bash
npm run build          # tsc → dist/
npm start              # node dist/index.js
```

## Environment variables

| Variable     | Default                  | Description                                     |
|--------------|--------------------------|-------------------------------------------------|
| `PORT`       | `8060`                   | WebSocket + HTTP port                           |
| `JWT_SECRET` | `secret`                 | Must match `mmar-server`'s `JWT_SECRET`         |
| `API_URL`    | `http://localhost:8000`  | Base URL of `mmar-server` (no trailing slash)   |

## Wire protocol

Clients connect with:
```
ws://<host>:8060/<sceneInstanceUuid>?token=<jwt>
```

Binary frames follow the [y-websocket](https://github.com/yjs/y-websocket) protocol:

| Outer byte | Meaning              | Gating                                        |
|-----------|----------------------|-----------------------------------------------|
| `0`       | Yjs sync message     | SyncStep2 / Update dropped for `read` connections |
| `1`       | Awareness update     | Always forwarded in both directions            |

## Close-code legend

| Code   | Reason                  | Client action                          |
|--------|-------------------------|----------------------------------------|
| `4401` | Unauthorised (bad JWT)  | Show login prompt                      |
| `4403` | Forbidden (no access)   | Show access-denied message             |
| `4500` | Upstream unavailable    | Retry with exponential back-off        |

## Health check

`GET /healthz` on the same port returns `200 ok` (plain text).
