import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);

// Serve static files from client dist in production
app.use(express.static(join(__dirname, '../../client/dist')));

// WebSocket server for signaling
const wss = new WebSocketServer({ server });

// Map of deviceId -> { ws, info }
const devices = new Map();

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join': {
        const { id, name } = msg.payload;
        devices.set(id, { ws, info: { id, name } });
        broadcastDeviceList();
        break;
      }

      case 'leave': {
        const { id } = msg.payload;
        devices.delete(id);
        broadcastDeviceList();
        break;
      }

      case 'signal': {
        const { to, data: signalData } = msg.payload;
        const target = devices.get(to);
        if (target && target.ws.readyState === WebSocket.OPEN) {
          target.ws.send(JSON.stringify({
            type: 'signal',
            payload: { from: msg.payload.from, data: signalData },
          }));
        }
        break;
      }

      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      }
    }
  });

  ws.on('close', () => {
    // Remove disconnected device
    for (const [id, device] of devices) {
      if (device.ws === ws) {
        devices.delete(id);
        broadcastDeviceList();
        break;
      }
    }
  });

  ws.on('error', () => {
    // Connection error handled by close event
  });
});

function broadcastDeviceList() {
  const list = Array.from(devices.values()).map((d) => d.info);
  const msg = JSON.stringify({ type: 'device-list', payload: list });
  for (const device of devices.values()) {
    if (device.ws.readyState === WebSocket.OPEN) {
      device.ws.send(msg);
    }
  }
}

// Heartbeat: remove stale connections
setInterval(() => {
  for (const [id, device] of devices) {
    if (device.ws.readyState !== WebSocket.OPEN) {
      devices.delete(id);
      broadcastDeviceList();
    }
  }
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Signaling server running on http://0.0.0.0:${PORT}`);
});
