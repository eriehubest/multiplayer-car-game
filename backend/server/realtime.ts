import { jsonResponse } from "./response.ts";
import { clampFinite, normalizeColor, normalizePlayerName, normalizeRoomId } from "./validation.ts";

const ROOM_BROADCAST_MS = 50;

type PlayerState = {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  updatedAt: number;
};

type Client = {
  id: string;
  socket: WebSocket;
  state: PlayerState;
};

type Room = {
  id: string;
  clients: Map<string, Client>;
  intervalId: ReturnType<typeof setInterval>;
};

type ClientMessage = {
  type: "player:update";
  x: number;
  y: number;
  angle: number;
  speed: number;
  color?: string;
  name?: string;
};

const rooms = new Map<string, Room>();

export function getRoomSummaries() {
  return [...rooms.values()].map((room) => ({
    id: room.id,
    players: room.clients.size,
  }));
}

export function handleWebSocket(request: Request, url: URL): Response {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return jsonResponse({ error: "Expected websocket upgrade" }, { status: 400 });
  }

  const roomId = normalizeRoomId(url.searchParams.get("roomId"));
  const playerName = normalizePlayerName(url.searchParams.get("name"));
  const playerColor = normalizeColor(url.searchParams.get("color")) ?? randomColor();
  const clientId = crypto.randomUUID();
  const { socket, response } = Deno.upgradeWebSocket(request);
  const room = getOrCreateRoom(roomId);

  const client: Client = {
    id: clientId,
    socket,
    state: {
      id: clientId,
      name: playerName,
      color: playerColor,
      x: 0,
      y: 0,
      angle: 0,
      speed: 0,
      updatedAt: Date.now(),
    },
  };

  socket.onopen = () => {
    room.clients.set(clientId, client);
    send(socket, {
      type: "player:welcome",
      id: clientId,
      roomId,
      tickMs: ROOM_BROADCAST_MS,
    });
    broadcastRoom(room, {
      type: "player:joined",
      player: client.state,
    });
  };

  socket.onmessage = (event) => {
    const message = parseClientMessage(event.data);

    if (!message) {
      send(socket, { type: "error", error: "Invalid message" });
      return;
    }

    updateClientState(client, message);
  };

  socket.onclose = () => {
    removeClient(roomId, clientId);
  };

  socket.onerror = () => {
    removeClient(roomId, clientId);
  };

  return response;
}

function getOrCreateRoom(roomId: string): Room {
  const existing = rooms.get(roomId);

  if (existing) return existing;

  const room: Room = {
    id: roomId,
    clients: new Map(),
    intervalId: setInterval(() => {
      const current = rooms.get(roomId);

      if (!current) return;

      broadcastRoomState(current);
    }, ROOM_BROADCAST_MS),
  };

  rooms.set(roomId, room);
  return room;
}

function removeClient(roomId: string, clientId: string) {
  const room = rooms.get(roomId);

  if (!room) return;

  room.clients.delete(clientId);
  broadcastRoom(room, { type: "player:left", id: clientId });

  if (room.clients.size === 0) {
    clearInterval(room.intervalId);
    rooms.delete(roomId);
  }
}

function updateClientState(client: Client, message: ClientMessage) {
  client.state = {
    ...client.state,
    name: message.name ? normalizePlayerName(message.name) : client.state.name,
    color: normalizeColor(message.color) ?? client.state.color,
    x: clampFinite(message.x),
    y: clampFinite(message.y),
    angle: clampFinite(message.angle),
    speed: clampFinite(message.speed),
    updatedAt: Date.now(),
  };
}

function broadcastRoomState(room: Room) {
  broadcastRoom(room, {
    type: "room:state",
    roomId: room.id,
    players: [...room.clients.values()].map((client) => client.state),
    sentAt: Date.now(),
  });
}

function broadcastRoom(room: Room, payload: unknown) {
  const encoded = JSON.stringify(payload);

  for (const client of room.clients.values()) {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(encoded);
    }
  }
}

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function parseClientMessage(data: unknown): ClientMessage | null {
  if (typeof data !== "string") return null;

  try {
    const value: unknown = JSON.parse(data);

    if (!isClientMessage(value)) return null;

    return value;
  } catch {
    return null;
  }
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;

  return (
    candidate.type === "player:update" &&
    typeof candidate.x === "number" &&
    typeof candidate.y === "number" &&
    typeof candidate.angle === "number" &&
    typeof candidate.speed === "number"
  );
}

function randomColor() {
  const colors = ["#ffcf33", "#52ff7a", "#61a8ff", "#ff67d8", "#ff7a59"];

  return colors[Math.floor(Math.random() * colors.length)];
}
