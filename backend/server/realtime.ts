import { jsonResponse } from "./response.ts";
import { clampFinite, normalizeColor, normalizePlayerName, normalizeRoomId } from "./validation.ts";

const ROOM_BROADCAST_MS = 50;
const STAR_MATCH_MS = 120_000;
const STAR_COUNT = 18;

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
  levelId: string;
  starMatch: StarMatch | null;
  clients: Map<string, Client>;
  intervalId: ReturnType<typeof setInterval>;
};

type Star = {
  id: string;
  x: number;
  y: number;
};

type StarMatch = {
  endsAt: number;
  stars: Star[];
  scores: Record<string, number>;
};

type ClientMessage =
  | {
    type: "player:update";
    x: number;
    y: number;
    angle: number;
    speed: number;
    color?: string;
    name?: string;
  }
  | {
    type: "room:level";
    levelId: string;
  }
  | {
    type: "star:collect";
    starId: string;
  };

type PlayerUpdateMessage = Extract<ClientMessage, { type: "player:update" }>;

const rooms = new Map<string, Room>();

export function getRoomSummaries() {
  return [...rooms.values()].map((room) => ({
    id: room.id,
    levelId: room.levelId,
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
      levelId: room.levelId,
      tickMs: ROOM_BROADCAST_MS,
    });
    send(socket, {
      type: "room:level",
      levelId: room.levelId,
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

    if (message.type === "room:level") {
      room.levelId = normalizeLevelId(message.levelId);
      room.starMatch = room.levelId === "starfall" ? createStarMatch() : null;
      broadcastRoom(room, {
        type: "room:level",
        levelId: room.levelId,
      });
      broadcastStarMatch(room);
      return;
    }

    if (message.type === "star:collect") {
      collectStar(room, client, message.starId);
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
    levelId: "loop",
    starMatch: null,
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

function updateClientState(client: Client, message: PlayerUpdateMessage) {
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
    starMatch: room.starMatch,
    sentAt: Date.now(),
  });
}

function collectStar(room: Room, client: Client, starId: string) {
  if (!room.starMatch || Date.now() > room.starMatch.endsAt) return;

  const index = room.starMatch.stars.findIndex((star) => star.id === starId);

  if (index === -1) return;

  room.starMatch.stars.splice(index, 1);
  room.starMatch.scores[client.id] = (room.starMatch.scores[client.id] ?? 0) + 1;

  if (room.starMatch.stars.length < STAR_COUNT) {
    room.starMatch.stars.push(createStar());
  }

  broadcastStarMatch(room);
}

function broadcastStarMatch(room: Room) {
  if (!room.starMatch) return;

  broadcastRoom(room, {
    type: "star:state",
    starMatch: room.starMatch,
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

  if (
    candidate.type === "player:update" &&
    typeof candidate.x === "number" &&
    typeof candidate.y === "number" &&
    typeof candidate.angle === "number" &&
    typeof candidate.speed === "number"
  ) {
    return true;
  }

  if (candidate.type === "room:level" && typeof candidate.levelId === "string") {
    return true;
  }

  return candidate.type === "star:collect" && typeof candidate.starId === "string";
}

function normalizeLevelId(value: string) {
  const levelId = value.trim().toLowerCase();

  return /^[a-z0-9-]{2,32}$/.test(levelId) ? levelId : "loop";
}

function randomColor() {
  const colors = ["#ffcf33", "#52ff7a", "#61a8ff", "#ff67d8", "#ff7a59"];

  return colors[Math.floor(Math.random() * colors.length)];
}

function createStarMatch(): StarMatch {
  return {
    endsAt: Date.now() + STAR_MATCH_MS,
    stars: Array.from({ length: STAR_COUNT }, () => createStar()),
    scores: {},
  };
}

function createStar(): Star {
  return {
    id: crypto.randomUUID(),
    x: 0.08 + Math.random() * 0.84,
    y: 0.16 + Math.random() * 0.68,
  };
}
