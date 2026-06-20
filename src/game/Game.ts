import { DEBUG_PANEL_WIDTH, GAME_INSET, createDefaultSettings } from "../config/gameSettings";
import { PlayerVehicle } from "../entities/PlayerVehicle";
import { InputState } from "../input/InputState";
import { MultiplayerClient, type RemotePlayerState } from "../multiplayer/MultiplayerClient";
import { LetterGrid } from "../rendering/LetterGrid";
import { DebugPanel } from "../ui/DebugPanel";
import { Minimap } from "../ui/Minimap";
import { Camera } from "../world/Camera";
import { PLAYER_RADIUS, WorldMap } from "../world/WorldMap";

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
    this.renderPlayer();
    this.renderMinimap();
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
      this.camera.follow(this.player, bounds, this.world.getBounds());
      this.camera.update(deltaSeconds);
      this.grid.updateCameraOffset(this.camera);
      this.renderPlayer();
      this.syncMultiplayer(now);
      this.renderMinimap();
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
        element.textContent = "▲";
        container.append(element);
      }

      element.style.color = player.color;
      element.style.left = `${player.x - this.camera.x}px`;
      element.style.top = `${player.y - this.camera.y}px`;
      element.style.transform = `
        translate(-50%, -50%)
        rotate(${player.angle + Math.PI / 2}rad)
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

  private isDebugEnabled() {
    return window.location.hash === "#debug";
  }
}
