import WebSocket from 'ws';
import type * as http from 'http';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { Connection } from './types';
import { getOrCreateRoom, removeConnection } from './room_manager';

export function handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
  const reqUrl = req.url ?? '/';
  const pathname = reqUrl.split('?')[0];
  const roomName = pathname.startsWith('/') ? pathname.slice(1) : pathname;

  if (!roomName) {
    ws.close(4400, 'missing-room-name');
    return;
  }

  const room = getOrCreateRoom(roomName);

  const connection: Connection = {
    ws,
    roomName,
    level: 'edit',
    isAlive: true,
    controlledAwarenessIds: new Set(),
  };

  room.connections.add(connection);
  console.log(JSON.stringify({ event: 'connection_accepted', room: roomName }));

  // Send sync step 1 so the new client can send back its state diff
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    ws.send(encoding.toUint8Array(encoder), { binary: true });
  }

  // Forward any existing awareness states to the new client
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
        // Sync message — readSyncMessage handles step1/step2/update internally
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, connection);
        // Send response (sync step 2 or nothing) back to this client only
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder), { binary: true });
        }
      } else if (messageType === 1) {
        // Awareness update — apply and broadcast via room awareness listener
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
    awarenessProtocol.removeAwarenessStates(
      room.awareness,
      Array.from(connection.controlledAwarenessIds),
      null
    );
    removeConnection(connection);
    console.log(JSON.stringify({ event: 'connection_closed', room: roomName }));
  });

  ws.on('error', (err: Error) => {
    console.error(JSON.stringify({ event: 'ws_error', room: roomName, error: err.message }));
    removeConnection(connection);
  });
}
