import * as http from 'http';
import * as dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { handleConnection } from './connection';

dotenv.config();

const PORT = parseInt(process.env['PORT'] ?? '8060', 10);

const server = http.createServer((_req, res) => {
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  handleConnection(ws, req).catch((err: unknown) => {
    console.error(JSON.stringify({ event: 'unhandled_connection_error', error: String(err) }));
    ws.terminate();
  });
});

server.listen(PORT, () => {
  console.log(`mmar-sync-server listening on :${PORT}`);
});
