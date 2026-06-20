const PORT = 8000;
const ROOM_BROADCAST_MS = 50;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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

type LeaderboardEntry = {
  id: string;
  name: string;
  time: number;
  createdAt: number;
};

const rooms = new Map<string, Room>();
const memoryLeaderboard: LeaderboardEntry[] = [];
let kvPromise: Promise<Deno.Kv | null> | null = null;

function jsonResponse(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...init.headers,
    },
  });
}

async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    return jsonResponse({
      status: "ok",
      service: "multiplayer-car-backend",
      rooms: rooms.size,
      time: new Date().toISOString(),
    });
  }

  if (url.pathname === "/api/rooms") {
    return jsonResponse({
      rooms: [...rooms.values()].map((room) => ({
        id: room.id,
        players: room.clients.size,
      })),
    });
  }

  if (url.pathname === "/api/leaderboard") {
    if (request.method === "GET") {
      return jsonResponse({ scores: await getLeaderboardScores() });
    }

    if (request.method === "POST") {
      return saveLeaderboardScore(request);
    }

    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  if (url.pathname === "/ws") {
    return handleWebSocket(request, url);
  }

  return jsonResponse({ error: "Not found" }, { status: 404 });
}

async function saveLeaderboardScore(request: Request) {
  const body = await parseJsonBody(request);
  const score = parseLeaderboardScore(body);

  if (!score) {
    return jsonResponse({ error: "Invalid score" }, { status: 400 });
  }

  const entry: LeaderboardEntry = {
    id: `${score.time.toFixed(3).padStart(12, "0")}-${Date.now()}-${crypto.randomUUID()}`,
    name: normalizeLeaderboardName(score.name),
    time: score.time,
    createdAt: Date.now(),
  };
  const kv = await getKv();

  if (kv) {
    await kv.set(["leaderboard", entry.id], entry);
  } else {
    memoryLeaderboard.push(entry);
  }

  return jsonResponse({ score: entry, scores: await getLeaderboardScores() }, { status: 201 });
}

async function getLeaderboardScores() {
  const kv = await getKv();
  const scores: LeaderboardEntry[] = [];

  if (kv) {
    for await (const entry of kv.list<LeaderboardEntry>({ prefix: ["leaderboard"] })) {
      scores.push(entry.value);
    }
  } else {
    scores.push(...memoryLeaderboard);
  }

  return scores
    .filter(isLeaderboardEntry)
    .sort((a, b) => a.time - b.time)
    .slice(0, 10);
}

function getKv() {
  if (!("openKv" in Deno) || typeof Deno.openKv !== "function") {
    return Promise.resolve(null);
  }

  kvPromise ??= Deno.openKv().catch((error) => {
    console.warn("Deno KV unavailable, falling back to in-memory leaderboard", error);
    return null;
  });

  return kvPromise;
}

async function parseJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function parseLeaderboardScore(value: unknown) {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.name !== "string" || typeof candidate.time !== "number") {
    return null;
  }

  if (!Number.isFinite(candidate.time) || candidate.time <= 0 || candidate.time > 3_600_000) {
    return null;
  }

  return {
    name: candidate.name,
    time: Math.round(candidate.time),
  };
}

function normalizeLeaderboardName(value: string) {
  const name = value.trim().replace(/\s+/g, " ");

  return (name || "player").slice(0, 18);
}

function isLeaderboardEntry(value: unknown): value is LeaderboardEntry {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.time === "number" &&
    typeof candidate.createdAt === "number"
  );
}

function handleWebSocket(request: Request, url: URL): Response {
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

function normalizeRoomId(value: string | null) {
  const roomId = value?.trim() || "default";

  return roomId.slice(0, 64).replaceAll(/[^\w-]/g, "-");
}

function normalizePlayerName(value: string | null) {
  const name = value?.trim() || "player";

  return name.slice(0, 24);
}

function normalizeColor(value: string | undefined | null) {
  if (!value) return null;

  return /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}

function clampFinite(value: number) {
  if (!Number.isFinite(value)) return 0;

  return Math.max(-1_000_000, Math.min(1_000_000, value));
}

function randomColor() {
  const colors = ["#ffcf33", "#52ff7a", "#61a8ff", "#ff67d8", "#ff7a59"];

  return colors[Math.floor(Math.random() * colors.length)];
}

if (import.meta.main) {
  console.log(`Multiplayer API listening on http://localhost:${PORT}`);
  Deno.serve({ port: PORT }, handler);
}
