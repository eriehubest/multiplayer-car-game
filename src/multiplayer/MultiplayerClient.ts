export type RemotePlayerState = {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  updatedAt: number;
};

type RoomStateMessage = {
  type: "room:state";
  players: RemotePlayerState[];
};

type WelcomeMessage = {
  type: "player:welcome";
  id: string;
};

type ServerMessage = RoomStateMessage | WelcomeMessage;

type LocalPlayerState = {
  name: string;
  color: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
};

const DEFAULT_WS_URL = "wss://multiplayer-car-game-rzp8s3vk94sj.eriehubest.deno.net/ws";
const SEND_INTERVAL_MS = 50;
const RECONNECT_DELAY_MS = 1500;

export class MultiplayerClient {
  private socket: WebSocket | null = null;
  private playerId: string | null = null;
  private remotePlayers = new Map<string, RemotePlayerState>();
  private lastSentAt = 0;
  private reconnectTimer: number | null = null;
  private shouldReconnect = true;

  constructor(
    private roomId = getRoomId(),
    private playerName = getPlayerName(),
    private socketUrl = getSocketUrl(),
  ) {}

  connect() {
    if (this.socket || !this.shouldReconnect) return;

    const url = new URL(this.socketUrl);
    url.searchParams.set("roomId", this.roomId);
    url.searchParams.set("name", this.playerName);

    this.socket = new WebSocket(url);

    this.socket.addEventListener("message", (event) => this.handleMessage(event.data));
    this.socket.addEventListener("close", () => this.handleDisconnect());
    this.socket.addEventListener("error", () => this.socket?.close());
  }

  sendPlayerState(state: LocalPlayerState, now = performance.now()) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (now - this.lastSentAt < SEND_INTERVAL_MS) return;

    this.lastSentAt = now;
    this.socket.send(JSON.stringify({
      type: "player:update",
      ...state,
    }));
  }

  getRemotePlayers() {
    return [...this.remotePlayers.values()];
  }

  disconnect() {
    this.shouldReconnect = false;

    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.socket?.close();
    this.socket = null;
  }

  private handleMessage(data: unknown) {
    if (typeof data !== "string") return;

    try {
      const message = JSON.parse(data) as ServerMessage;

      if (message.type === "player:welcome") {
        this.playerId = message.id;
        return;
      }

      if (message.type === "room:state") {
        this.remotePlayers.clear();

        for (const player of message.players) {
          if (player.id !== this.playerId) {
            this.remotePlayers.set(player.id, player);
          }
        }
      }
    } catch {
      // Ignore malformed network messages; the next room state will replace it.
    }
  }

  private handleDisconnect() {
    this.socket = null;
    this.remotePlayers.clear();

    if (!this.shouldReconnect || this.reconnectTimer !== null) return;

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }
}

function getRoomId() {
  const params = new URLSearchParams(window.location.search);

  return params.get("room") || "main";
}

function getPlayerName() {
  const params = new URLSearchParams(window.location.search);

  return params.get("name") || `Player-${Math.floor(Math.random() * 1000)}`;
}

function getSocketUrl() {
  const params = new URLSearchParams(window.location.search);
  const override = params.get("ws");

  if (override) return override;

  if (window.location.hostname === "localhost") {
    return "ws://localhost:8000/ws";
  }

  return DEFAULT_WS_URL;
}
