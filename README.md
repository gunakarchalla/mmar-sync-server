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
| `ACCESS_REVALIDATE_INTERVAL_MS` | `15000` | How often an open connection's access grant is re-checked |

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
| `4403` | Forbidden (no access)   | Show access-denied message, close the scene tab |
| `4500` | Upstream unavailable    | Retry with exponential back-off        |

## Access revalidation

A grant lives in `mmar-server` and can be changed or removed at any moment, while a
WebSocket outlives the request that authorised it. The grant behind every open
connection is therefore re-read every `ACCESS_REVALIDATE_INTERVAL_MS`, not only at
connect time:

- access removed → the connection is closed with `4403`, so a user who is viewing or
  editing the scene stops receiving updates and the client closes their tab;
- level changed → the connection is kept and its read/write gating follows the new level;
- token no longer accepted → the connection is closed with `4401`;
- `mmar-server` unreachable or failing → the current level stands and the check is
  retried on the next tick, so a transient outage does not disconnect everyone.

Revocation therefore takes effect within one interval rather than instantly; the
trade-off is that no notification path from `mmar-server` to this server is needed, and
a grant removed by any means (including directly in the database) is still picked up.

## Health check

`GET /healthz` on the same port returns `200 ok` (plain text).
