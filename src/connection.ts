import WebSocket from 'ws';
import type * as http from 'http';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import axios from 'axios';
import type { AccessLevel, Connection } from './types';
import { getOrCreateRoom, removeConnection } from './room_manager';
import { verifyToken, fetchAccessLevel } from './auth';
import { getCached, setCached } from './access_cache';

const PING_INTERVAL_MS = 30_000;

// How often a live connection's access grant is re-read from the API server.
const ACCESS_REVALIDATE_INTERVAL_MS = parseInt(
  process.env['ACCESS_REVALIDATE_INTERVAL_MS'] ?? '15000',
  10
);

export async function handleConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
  const reqUrl = req.url ?? '/';
  const [pathname, queryString] = reqUrl.split('?') as [string, string | undefined];
  const roomName = pathname.startsWith('/') ? pathname.slice(1) : pathname;

  if (!roomName) {
    ws.close(4400, 'missing-room-name');
    return;
  }

  const params = new URLSearchParams(queryString ?? '');
  const token = params.get('token');

  if (!token) {
    console.log(JSON.stringify({ event: 'connection_rejected', room: roomName, code: 4401, reason: 'no-token' }));
    ws.close(4401, 'unauthorised');
    return;
  }

  // Verify JWT signature locally before making an API round-trip
  try {
    verifyToken(token);
  } catch {
    console.log(JSON.stringify({ event: 'connection_rejected', room: roomName, code: 4401, reason: 'bad-jwt' }));
    ws.close(4401, 'unauthorised');
    return;
  }

  // Fetch access level from API server (with short-lived cache to absorb reconnect storms)
  let level;
  try {
    const cached = getCached(token, roomName);
    if (cached !== undefined) {
      level = cached;
    } else {
      level = await fetchAccessLevel(token, roomName);
      setCached(token, roomName, level);
    }
  } catch (err) {
    // HTTP 4xx from the API means the token/room is forbidden — not that the upstream is down.
    // Only treat network errors and 5xx as genuinely unavailable.
    if (axios.isAxiosError(err) && err.response && err.response.status < 500) {
      // Cache null so a reconnect storm doesn't hammer the API for a forbidden resource.
      setCached(token, roomName, null);
      console.log(JSON.stringify({ event: 'connection_rejected', room: roomName, code: 4403, reason: 'forbidden', status: err.response.status }));
      ws.close(4403, 'forbidden');
    } else {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(JSON.stringify({ event: 'connection_rejected', room: roomName, code: 4500, reason: 'upstream-unavailable', error: errMsg }));
      ws.close(4500, 'upstream-unavailable');
    }
    return;
  }

  if (level === null) {
    console.log(JSON.stringify({ event: 'connection_rejected', room: roomName, code: 4403, reason: 'forbidden' }));
    ws.close(4403, 'forbidden');
    return;
  }

  const room = getOrCreateRoom(roomName);

  const connection: Connection = {
    ws,
    roomName,
    level,
    isAlive: true,
    controlledAwarenessIds: new Set(),
  };

  room.connections.add(connection);
  console.log(JSON.stringify({ event: 'connection_accepted', room: roomName, level }));

  // Heartbeat: ping every 30 s; terminate if no pong arrives before the next ping.
  const pingTimer = setInterval(() => {
    if (!connection.isAlive) {
      console.log(JSON.stringify({ event: 'connection_timeout', room: roomName }));
      ws.terminate();
      return;
    }
    connection.isAlive = false;
    ws.ping();
  }, PING_INTERVAL_MS);

  ws.on('pong', () => {
    connection.isAlive = true;
  });

  // A grant lives in the API server and can be changed or removed at any moment, while
  // a WebSocket outlives the request that authorised it. The grant behind an open
  // connection is therefore re-read on an interval: a user whose access is gone is
  // closed with 4403 (the client turns that into an access-denied notice and closes the
  // scene tab), and a user whose level merely changed keeps the connection with the
  // read/write gating that now applies to them.
  let revalidating = false;

  const revalidateAccess = async (): Promise<void> => {
    if (revalidating || ws.readyState !== WebSocket.OPEN) return;
    revalidating = true;

    try {
      let current: AccessLevel | null;
      try {
        const cached = getCached(token, roomName);
        if (cached !== undefined) {
          current = cached;
        } else {
          current = await fetchAccessLevel(token, roomName);
          setCached(token, roomName, current);
        }
      } catch (err) {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        if (status === 401) {
          // The token expired or was invalidated while the connection was open.
          console.log(JSON.stringify({ event: 'connection_closed_by_revalidation', room: roomName, code: 4401, reason: 'unauthorised' }));
          ws.close(4401, 'unauthorised');
          return;
        }
        if (status !== undefined && status < 500) {
          setCached(token, roomName, null);
          current = null;
        } else {
          // The API server is unreachable or failing. A transient outage must not
          // disconnect everyone, so the current level stands until the next tick.
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(JSON.stringify({ event: 'revalidation_error', room: roomName, error: errMsg }));
          return;
        }
      }

      if (ws.readyState !== WebSocket.OPEN) return;

      if (current === null) {
        console.log(JSON.stringify({ event: 'connection_closed_by_revalidation', room: roomName, code: 4403, reason: 'access-revoked' }));
        ws.close(4403, 'forbidden');
        return;
      }

      if (current !== connection.level) {
        console.log(JSON.stringify({ event: 'access_level_changed', room: roomName, from: connection.level, to: current }));
        connection.level = current;
      }
    } finally {
      revalidating = false;
    }
  };

  const accessTimer = setInterval(() => {
    void revalidateAccess();
  }, ACCESS_REVALIDATE_INTERVAL_MS);

  // Send sync step 1 so the new client can reply with its state diff
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    ws.send(encoding.toUint8Array(encoder), { binary: true });
  }

  // Forward existing awareness states to the new client
  const awarenessStates = room.awareness.getStates();
  if (awarenessStates.size > 0) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(awarenessStates.keys()))
    );
    ws.send(encoding.toUint8Array(encoder), { binary: true });
  }

  ws.on('message', (data: WebSocket.RawData) => {
    let buf: Uint8Array;
    if (Buffer.isBuffer(data)) {
      buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else if (data instanceof ArrayBuffer) {
      buf = new Uint8Array(data);
    } else {
      buf = new Uint8Array(Buffer.concat(data as Buffer[]));
    }

    try {
      const decoder = decoding.createDecoder(buf);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === 0) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);

        if (connection.level === 'read') {
          // Read-only: respond to SyncStep1 (so the client can receive current doc state)
          // but drop SyncStep2/Update to prevent any doc mutations (defense-in-depth).
          const syncSubType = decoding.readVarUint(decoder);
          if (syncSubType === syncProtocol.messageYjsSyncStep1) {
            syncProtocol.readSyncStep1(decoder, encoder, room.doc);
          }
          // syncSubType 1 (step2) or 2 (yjsUpdate): drop silently
        } else {
          syncProtocol.readSyncMessage(decoder, encoder, room.doc, connection);
        }

        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder), { binary: true });
        }
      } else if (messageType === 1) {
        // Awareness — always forwarded regardless of access level
        awarenessProtocol.applyAwarenessUpdate(
          room.awareness,
          decoding.readVarUint8Array(decoder),
          connection
        );
      } else {
        console.log(
          JSON.stringify({ event: 'unknown_message_type', type: messageType, room: roomName })
        );
      }
    } catch (err) {
      console.error(
        JSON.stringify({ event: 'message_error', room: roomName, error: String(err) })
      );
    }
  });

  ws.on('close', () => {
    clearInterval(pingTimer);
    clearInterval(accessTimer);
    awarenessProtocol.removeAwarenessStates(
      room.awareness,
      Array.from(connection.controlledAwarenessIds),
      'connection-closed'
    );
    removeConnection(connection);
    console.log(JSON.stringify({ event: 'connection_closed', room: roomName }));
  });

  ws.on('error', (err: Error) => {
    clearInterval(pingTimer);
    clearInterval(accessTimer);
    console.error(JSON.stringify({ event: 'ws_error', room: roomName, error: err.message }));
    removeConnection(connection);
  });
}
