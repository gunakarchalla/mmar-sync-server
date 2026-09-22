import type WebSocket from 'ws';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

export type AccessLevel = 'read' | 'edit' | 'delete';

export interface Connection {
  ws: WebSocket;
  roomName: string;
  level: AccessLevel;
  isAlive: boolean;
  controlledAwarenessIds: Set<number>;
}

export interface Room {
  name: string;
  doc: Y.Doc;
  awareness: Awareness;
  connections: Set<Connection>;
}
