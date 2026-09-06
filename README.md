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
## License

This repository is licensed under the GNU AFFERO GENERAL PUBLIC LICENSE Version 3. 

The GNU Affero General Public License (GNU AGPL) is a free, copyleft license published by the Free Software Foundation in November 2007, and based on the GNU GPL version 3 and the Affero General Public License. It is intended for software designed to be run over a network, adding a provision requiring that the corresponding source code of modified versions of the software be prominently offered to all users who interact with the software over a network (https://en.wikipedia.org/wiki/GNU_Affero_General_Public_License).

The GNU AGPL is specifically designed to ensure cooperation with the community in the case of network server software. The licenses for most software are designed to take away your freedom to share and change the works. By contrast, the GNU AGPL is intended to guarantee your freedom to share and change all versions of a program–to make sure it remains free software for all its users (https://www.gnu.org/licenses/agpl-3.0.en.html).

This means that any kind of published change done to the repository must be published again under the same license. For more information have a look at the LICENSE file.
