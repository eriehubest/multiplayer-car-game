import { DEBUG_PANEL_WIDTH, GAME_INSET, createDefaultSettings } from "../config/gameSettings";
import { PlayerVehicle } from "../entities/PlayerVehicle";
import { InputState } from "../input/InputState";
import { MultiplayerClient, type RemotePlayerState } from "../multiplayer/MultiplayerClient";
import { LetterGrid } from "../rendering/LetterGrid";
import { DebugPanel } from "../ui/DebugPanel";
import { Minimap } from "../ui/Minimap";
import { Camera } from "../world/Camera";
import { PLAYER_RADIUS, WorldMap } from "../world/WorldMap";

type LeaderboardEntry = {
  id: string;
  name: string;
  time: number;
  createdAt: number;
};

const DEFAULT_API_URL = "https://multiplayer-car-game-sfaz423w96tp.eriehubest.deno.net";

export class Game {
  private settings = createDefaultSettings();
  private input = new InputState();
  private player = new PlayerVehicle(this.input, this.settings);
  private camera = new Camera();
  private world = new WorldMap();
  private grid: LetterGrid;
  private debugPanel = new DebugPanel(this.settings);
  private multiplayer = new MultiplayerClient();
  private minimap: Minimap | null = null;
  private isPlayerPlaced = false;
  private lastFrame = performance.now();
  private raceTimer = {
    status: "idle" as "idle" | "running" | "finished",
    startTime: 0,
    finalElapsed: 0,
  };
  private hasSavedCurrentScore = false;
  private leaderboardEntries: LeaderboardEntry[] = [];
  private leaderboardError = "";

  constructor(private root: HTMLElement) {
    this.grid = new LetterGrid(root, this.settings);
  }

  start() {
    this.renderLayout();
    this.bindWindowEvents();
    this.multiplayer.connect();
    requestAnimationFrame((now) => this.tick(now));
  }

  private renderLayout() {
    const debugWidth = this.isDebugEnabled() ? DEBUG_PANEL_WIDTH : 0;
    const viewportWidth = Math.max(window.innerWidth - debugWidth - GAME_INSET * 2, 1);
    const viewportHeight = Math.max(window.innerHeight - GAME_INSET * 2, 1);

    this.world.resizeToViewport(viewportWidth, viewportHeight);
    this.grid.render(
      this.isDebugEnabled() ? this.debugPanel.render() : "",
      this.world,
      this.camera,
      viewportWidth,
      viewportHeight,
    );
    this.placePlayer();
    this.bindMinimap();
    if (this.isDebugEnabled()) {
      this.bindDebugPanel();
    }
    this.bindLeaderboard();
    this.renderPlayer();
    this.renderMinimap();
    this.renderRaceHud();
    this.renderLeaderboard();
    this.grid.updateActiveLetter(this.player);
    this.debugPanel.updateReadout(this.player);
  }

  private placePlayer() {
    const playfield = this.grid.getPlayfield();

    if (!playfield) return;

    const bounds = playfield.getBoundingClientRect();

    if (!this.isPlayerPlaced) {
      this.player.placeAt(this.world.spawn.x, this.world.spawn.y);
      this.camera.follow(this.player, bounds, this.world.getBounds());
      this.camera.snapToTarget();
      this.isPlayerPlaced = true;
      return;
    }
  }

  private bindDebugPanel() {
    this.debugPanel.bind({
      onLetterColorChange: () => this.renderLayout(),
      onPlayerColorChange: () => {
        this.grid.getPlayfield()
          ?.style.setProperty("--player-color", this.settings.playerColor);
      },
    });
  }

  private bindWindowEvents() {
    window.addEventListener("resize", () => this.renderLayout());
    window.addEventListener("hashchange", () => this.renderLayout());
    window.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement || !this.input.handles(event.key)) return;

      event.preventDefault();
      this.input.setKey(event.key, true);
    });

    window.addEventListener("keyup", (event) => {
      if (!this.input.handles(event.key)) return;

      event.preventDefault();
      this.input.setKey(event.key, false);
    });
  }

  private tick(now: number) {
    const deltaSeconds = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;

    const playfield = this.grid.getPlayfield();

    if (playfield) {
      const bounds = playfield.getBoundingClientRect();

      this.updatePlayerWithCollision(deltaSeconds);
      this.updateRaceProgress(now);
      this.camera.follow(this.player, bounds, this.world.getBounds());
      this.camera.update(deltaSeconds);
      this.grid.updateCameraOffset(this.camera);
      this.renderPlayer();
      this.syncMultiplayer(now);
      this.renderMinimap();
      this.renderRaceHud(now);
      this.grid.updateActiveLetter(this.player);
      this.debugPanel.updateReadout(this.player);
    }

    requestAnimationFrame((nextNow) => this.tick(nextNow));
  }

  private renderPlayer() {
    this.player.render(this.grid.getPlayerElement(), this.camera.x, this.camera.y);
  }

  private syncMultiplayer(now: number) {
    this.multiplayer.sendPlayerState({
      name: "player",
      color: this.settings.playerColor,
      x: this.player.x,
      y: this.player.y,
      angle: this.player.angle,
      speed: this.player.speed,
    }, now);

    this.renderRemotePlayers(this.multiplayer.getRemotePlayers());
  }

  private renderRemotePlayers(players: RemotePlayerState[]) {
    const container = this.grid.getRemotePlayersElement();

    if (!container) return;

    const existing = new Map(
      [...container.querySelectorAll<HTMLElement>(".remote-player")]
        .map((element) => [element.dataset.playerId ?? "", element]),
    );

    for (const player of players) {
      let element = existing.get(player.id);

      if (!element) {
        element = document.createElement("span");
        element.className = "remote-player";
        element.dataset.playerId = player.id;
        element.textContent = "car";
        container.append(element);
      }

      element.style.color = player.color;
      element.style.left = `${player.x - this.camera.x}px`;
      element.style.top = `${player.y - this.camera.y}px`;
      element.style.transform = `
        translate(-50%, -50%)
        rotate(${player.angle}rad)
      `;
      element.title = player.name;
      existing.delete(player.id);
    }

    for (const element of existing.values()) {
      element.remove();
    }
  }

  private bindMinimap() {
    const canvas = this.grid.getMinimapElement();

    this.minimap = canvas ? new Minimap(canvas) : null;
  }

  private renderMinimap() {
    this.minimap?.render(this.world, this.player);
  }

  private resolveTrackCollision() {
    const cell = this.grid.getCellSize();
    const collision = this.world.resolveCircleAgainstBlocks(
      this.player.x,
      this.player.y,
      PLAYER_RADIUS,
      cell.width,
      cell.height,
    );

    if (!collision.collided) return;

    this.player.placeAt(collision.x, collision.y);
    this.player.removeVelocityAlong(collision.normal);
  }

  private updatePlayerWithCollision(deltaSeconds: number) {
    const maxSubstep = 1 / 240;
    const steps = Math.max(1, Math.ceil(deltaSeconds / maxSubstep));
    const substep = deltaSeconds / steps;

    for (let index = 0; index < steps; index += 1) {
      this.player.update(substep, this.world.getPlayableBounds());
      this.resolveTrackCollision();
    }
  }

  private updateRaceProgress(now: number) {
    const isOnStartLine = this.world.isOnStartLine(this.player.x, this.player.y, PLAYER_RADIUS);

    if (this.raceTimer.status === "idle" && isOnStartLine) {
      this.raceTimer.status = "running";
      this.raceTimer.startTime = now;
    }

    if (this.raceTimer.status === "running") {
      this.world.updateRaceProgress(this.player.x, this.player.y, PLAYER_RADIUS);

      if (this.world.isFinished() && isOnStartLine) {
        this.raceTimer.status = "finished";
        this.raceTimer.finalElapsed = now - this.raceTimer.startTime;
        this.hasSavedCurrentScore = false;
      }
    }
  }

  private renderRaceHud(now = performance.now()) {
    const element = this.grid.getRaceHudElement();

    if (!element) return;

    const progress = this.world.getCheckpointProgress();
    const elapsed = this.getRaceElapsed(now);
    const finalTime = this.raceTimer.status === "finished"
      ? this.formatSeconds(this.raceTimer.finalElapsed)
      : "--.--";

    element.innerHTML = `
      <div>
        <span>checkpoints</span>
        <strong>${progress.completed}/${progress.total}</strong>
      </div>
      <div>
        <span>speed</span>
        <strong>${Math.round(this.player.speed)}px/s</strong>
      </div>
      <div>
        <span>time</span>
        <strong>${this.formatSeconds(elapsed)}</strong>
      </div>
      <div>
        <span>final</span>
        <strong>${finalTime}</strong>
      </div>
    `;
  }

  private bindLeaderboard() {
    this.grid.getLeaderboardButton()?.addEventListener("click", () => {
      const panel = this.grid.getLeaderboardPanel();

      if (panel) panel.hidden = false;
      void this.refreshLeaderboard();
    });

    this.grid.getLeaderboardCloseButton()?.addEventListener("click", () => {
      const panel = this.grid.getLeaderboardPanel();

      if (panel) panel.hidden = true;
    });

    this.grid.getLeaderboardPanel()?.addEventListener("click", (event) => {
      if (event.target !== event.currentTarget) return;

      this.grid.getLeaderboardPanel()!.hidden = true;
    });

    this.grid.getLeaderboardForm()?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.saveLeaderboardScore();
    });
  }

  private renderLeaderboard() {
    const list = this.grid.getLeaderboardList();
    const note = this.grid.getLeaderboardNote();
    const input = this.grid.getLeaderboardNameInput();
    const formButton = this.grid.getLeaderboardForm()?.querySelector<HTMLButtonElement>("button");
    const entries = this.leaderboardEntries;

    if (list) {
      list.innerHTML = entries.length > 0
        ? entries.map((entry) => `
          <li>
            ${this.escapeHtml(entry.name)}
            <span>${this.formatSeconds(entry.time)}</span>
          </li>
        `).join("")
        : `<li><span>no scores yet</span></li>`;
    }

    const canSave = this.raceTimer.status === "finished" && !this.hasSavedCurrentScore;

    if (input) {
      input.disabled = !canSave;
      input.placeholder = canSave ? "name" : "finish a run first";
    }

    if (formButton) {
      formButton.disabled = !canSave;
    }

    if (note) {
      if (this.leaderboardError) {
        note.textContent = this.leaderboardError;
      } else {
        note.textContent = canSave
          ? `current score: ${this.formatSeconds(this.raceTimer.finalElapsed)}`
          : this.raceTimer.status === "finished"
            ? "score saved"
            : "finish the race to save a score";
      }
    }
  }

  private async saveLeaderboardScore() {
    const input = this.grid.getLeaderboardNameInput();

    if (!input || this.raceTimer.status !== "finished" || this.hasSavedCurrentScore) return;

    const name = input.value.trim();

    if (!name) return;

    try {
      const response = await fetch(`${getApiUrl()}/api/leaderboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          time: this.raceTimer.finalElapsed,
        }),
      });

      if (!response.ok) {
        throw new Error(`Leaderboard save failed: ${response.status}`);
      }

      const data = await response.json() as { scores?: unknown };

      this.leaderboardEntries = this.parseLeaderboardEntries(data.scores);
      this.leaderboardError = "";
      input.value = "";
      this.hasSavedCurrentScore = true;
    } catch {
      this.leaderboardError = "leaderboard unavailable";
    }

    this.renderLeaderboard();
  }

  private async refreshLeaderboard() {
    try {
      const response = await fetch(`${getApiUrl()}/api/leaderboard`);

      if (!response.ok) {
        throw new Error(`Leaderboard fetch failed: ${response.status}`);
      }

      const data = await response.json() as { scores?: unknown };

      this.leaderboardEntries = this.parseLeaderboardEntries(data.scores);
      this.leaderboardError = "";
    } catch {
      this.leaderboardError = "leaderboard unavailable";
    }

    this.renderLeaderboard();
  }

  private parseLeaderboardEntries(value: unknown) {
    if (!Array.isArray(value)) return [];

    return value
      .filter((entry): entry is LeaderboardEntry => (
        entry &&
        typeof entry === "object" &&
        typeof (entry as LeaderboardEntry).id === "string" &&
        typeof (entry as LeaderboardEntry).name === "string" &&
        typeof (entry as LeaderboardEntry).time === "number" &&
        typeof (entry as LeaderboardEntry).createdAt === "number"
      ))
      .sort((a, b) => a.time - b.time)
      .slice(0, 10);
  }

  private getRaceElapsed(now: number) {
    if (this.raceTimer.status === "idle") return 0;
    if (this.raceTimer.status === "finished") return this.raceTimer.finalElapsed;

    return now - this.raceTimer.startTime;
  }

  private formatSeconds(milliseconds: number) {
    return `${(milliseconds / 1000).toFixed(2)}s`;
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private isDebugEnabled() {
    return window.location.hash === "#debug";
  }
}

function getApiUrl() {
  const params = new URLSearchParams(window.location.search);
  const override = params.get("api");

  if (override) return override;

  if (window.location.hostname === "localhost") {
    return "http://localhost:8000";
  }

  return DEFAULT_API_URL;
}
