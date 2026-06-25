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

export type StarState = {
  id: string;
  x: number;
  y: number;
};

export type StarMatchState = {
  endsAt: number;
  stars: StarState[];
  scores: Record<string, number>;
};

type RoomStateMessage = {
  type: "room:state";
  players: RemotePlayerState[];
  starMatch?: StarMatchState | null;
};

type WelcomeMessage = {
  type: "player:welcome";
  id: string;
  levelId?: string;
};

type RoomLevelMessage = {
  type: "room:level";
  levelId: string;
};

type StarStateMessage = {
  type: "star:state";
  starMatch: StarMatchState;
};

type ServerMessage = RoomStateMessage | WelcomeMessage | RoomLevelMessage | StarStateMessage;

type LocalPlayerState = {
  name: string;
  color: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
};

const DEFAULT_WS_URL = "wss://multiplayer-car-game-ezgseam08x6y.eriehubest.deno.net/ws";
const SEND_INTERVAL_MS = 50;
const RECONNECT_DELAY_MS = 1500;

export class MultiplayerClient {
  private socket: WebSocket | null = null;
  private playerId: string | null = null;
  private remotePlayers = new Map<string, RemotePlayerState>();
  private lastSentAt = 0;
  private reconnectTimer: number | null = null;
  private shouldReconnect = true;
  private onLevelChange: ((levelId: string) => void) | null = null;
  private onStarMatchChange: ((state: StarMatchState | null) => void) | null = null;
  private pendingLevelId: string | null = null;

  constructor(
    private roomId = getRoomId(),
    private playerName = getPlayerName(),
    private socketUrl = getSocketUrl(),
  ) {}

  connect() {
    this.shouldReconnect = true;

    if (this.socket) return;

    const url = new URL(this.socketUrl);
    url.searchParams.set("roomId", this.roomId);
    url.searchParams.set("name", this.playerName);

    this.socket = new WebSocket(url);

    this.socket.addEventListener("open", () => {
      if (this.pendingLevelId) {
        this.sendLevel(this.pendingLevelId);
      }
    });
    this.socket.addEventListener("message", (event) => this.handleMessage(event.data));
    this.socket.addEventListener("close", () => this.handleDisconnect());
    this.socket.addEventListener("error", () => this.socket?.close());
  }

  configure(options: {
    roomId: string;
    playerName: string;
    onLevelChange?: (levelId: string) => void;
    onStarMatchChange?: (state: StarMatchState | null) => void;
  }) {
    this.disconnect();
    this.roomId = options.roomId;
    this.playerName = options.playerName;
    this.onLevelChange = options.onLevelChange ?? null;
    this.onStarMatchChange = options.onStarMatchChange ?? null;
    this.shouldReconnect = true;
  }

  setLevel(levelId: string) {
    this.pendingLevelId = levelId;
    this.sendLevel(levelId);
  }

  private sendLevel(levelId: string) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    this.socket.send(JSON.stringify({
      type: "room:level",
      levelId,
    }));
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

  collectStar(starId: string) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    this.socket.send(JSON.stringify({
      type: "star:collect",
      starId,
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
    this.playerId = null;
    this.remotePlayers.clear();
  }

  private handleMessage(data: unknown) {
    if (typeof data !== "string") return;

    try {
      const message = JSON.parse(data) as ServerMessage;

      if (message.type === "player:welcome") {
        this.playerId = message.id;
        if (message.levelId) this.onLevelChange?.(message.levelId);
        return;
      }

      if (message.type === "room:level") {
        this.onLevelChange?.(message.levelId);
        return;
      }

      if (message.type === "room:state") {
        this.remotePlayers.clear();

        for (const player of message.players) {
          if (player.id !== this.playerId) {
            this.remotePlayers.set(player.id, player);
          }
        }

        if ("starMatch" in message) {
          this.onStarMatchChange?.(message.starMatch ?? null);
        }
        return;
      }

      if (message.type === "star:state") {
        this.onStarMatchChange?.(message.starMatch);
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
