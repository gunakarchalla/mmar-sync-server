import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import WebSocket from 'ws';
import type { Room, Connection } from './types';

const rooms = new Map<string, Room>();

function broadcast(room: Room, message: Uint8Array, exclude?: Connection): void {
  room.connections.forEach(conn => {
    if (conn !== exclude && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(message, { binary: true });
    }
  });
}

export function getOrCreateRoom(name: string): Room {
  const existing = rooms.get(name);
  if (existing) return existing;

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  const room: Room = { name, doc, awareness, connections: new Set() };

  doc.on('update', (update: Uint8Array, origin: Connection | null) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, update);
    broadcast(room, encoding.toUint8Array(encoder), origin ?? undefined);
  });

  awareness.on(
    'update',
    (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown
    ) => {
      const conn = origin as Connection | null;
      if (conn != null) {
        added.forEach(id => conn.controlledAwarenessIds.add(id));
        removed.forEach(id => conn.controlledAwarenessIds.delete(id));
      }

      const changedClients = [...added, ...updated, ...removed];
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 1);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
      );
      broadcast(room, encoding.toUint8Array(encoder));
    }
  );

  rooms.set(name, room);
  console.log(JSON.stringify({ event: 'room_created', room: name }));
  return room;
}

export function removeConnection(connection: Connection): void {
  const room = rooms.get(connection.roomName);
  if (!room) return;

  room.connections.delete(connection);

  if (room.connections.size === 0) {
    room.doc.destroy();
    rooms.delete(connection.roomName);
    console.log(JSON.stringify({ event: 'room_destroyed', room: connection.roomName }));
  }
}
