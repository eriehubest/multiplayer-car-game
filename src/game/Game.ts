import { DEBUG_PANEL_WIDTH, GAME_INSET, createDefaultSettings } from "../config/gameSettings";
import { PlayerVehicle } from "../entities/PlayerVehicle";
import { InputState } from "../input/InputState";
import { Vector2 } from "../math/Vector2";
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

type StoredUser = {
  username: string;
  password: string;
  carLabel: string;
  carColor: string;
};

type MenuView = "auth" | "main" | "singleplayer" | "multiplayer" | "lobby" | "levels" | "customize" | "hidden";
type AuthMode = "login" | "register";
type PlayMode = "singleplayer" | "multiplayer";

const DEFAULT_API_URL = "https://multiplayer-car-game-ezgseam08x6y.eriehubest.deno.net";
const USERS_KEY = "letter-racer-users";
const CURRENT_USER_KEY = "letter-racer-current-user";

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
  private currentUser: StoredUser | null = null;
  private menuView: MenuView = "auth";
  private authMode: AuthMode = "login";
  private playMode: PlayMode = "singleplayer";
  private lobbyCode = "";
  private isLobbyHost = false;
  private selectedLevelId = this.world.getCurrentLevel().id;
  private isRaceActive = false;
  private isMultiplayerConnected = false;
  private menuMessage = "";
  private loading = {
    active: false,
    message: "",
  };

  constructor(private root: HTMLElement) {
    this.grid = new LetterGrid(root, this.settings);
    this.currentUser = this.loadCurrentUser();
    this.menuView = this.currentUser ? "main" : "auth";
    this.applyCurrentUserCustomization();
  }

  start() {
    this.renderLayout();
    this.bindWindowEvents();
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
    this.bindMenu();
    this.renderPlayer();
    this.renderMinimap();
    this.renderRaceHud();
    this.renderLeaderboard();
    this.renderMenu();
    this.renderLoading();
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
      onTrackFontChange: () => this.renderLayout(),
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

      if (this.isRaceActive) {
        this.updatePlayerWithCollision(deltaSeconds);
        this.resolveHoleFall();
        this.updateRaceProgress(now);
      }
      this.camera.follow(this.player, bounds, this.world.getBounds());
      this.camera.update(deltaSeconds);
      this.grid.updateCameraOffset(this.camera);
      this.renderPlayer();
      if (this.isRaceActive) {
        this.syncMultiplayer(now);
      }
      this.renderMinimap();
      this.renderRaceHud(now);
      this.grid.updateActiveLetter(this.player);
      this.debugPanel.updateReadout(this.player);
    }

    requestAnimationFrame((nextNow) => this.tick(nextNow));
  }

  private renderPlayer() {
    const element = this.grid.getPlayerElement();

    if (element) {
      element.textContent = this.settings.playerLabel;
    }

    this.player.render(element, this.camera.x, this.camera.y);
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
    const footprint = this.player.getFootprint();
    const probeRadius = 5;
    const samplePoints = [footprint.center, ...footprint.corners];
    let totalNormalX = 0;
    let totalNormalY = 0;
    let collided = false;

    for (const point of samplePoints) {
      const collision = this.world.resolveCircleAgainstBlocks(
        point.x,
        point.y,
        probeRadius,
        cell.width,
        cell.height,
      );

      if (!collision.collided) continue;

      this.player.placeAt(
        this.player.x + collision.x - point.x,
        this.player.y + collision.y - point.y,
      );
      totalNormalX += collision.normal.x;
      totalNormalY += collision.normal.y;
      collided = true;
    }

    if (collided) {
      this.player.removeVelocityAlong(new Vector2(totalNormalX, totalNormalY).normalize());
    }
  }

  private updatePlayerWithCollision(deltaSeconds: number) {
    const maxSubstep = 1 / 240;
    const steps = Math.max(1, Math.ceil(deltaSeconds / maxSubstep));
    const substep = deltaSeconds / steps;

    for (let index = 0; index < steps; index += 1) {
      this.player.update(substep, this.world.getPlayableBounds());
      this.applySurfaceEffect(substep);
      this.resolveTrackCollision();
    }
  }

  private applySurfaceEffect(deltaSeconds: number) {
    const effect = this.world.getSurfaceEffect(this.player.x, this.player.y);

    if (effect === "boost") {
      this.player.triggerBoost();
      this.player.velocity.scale(1 + 2.4 * deltaSeconds);
      return;
    }

    if (effect === "trap") {
      this.player.velocity.scale(Math.max(0, 1 - 2.2 * deltaSeconds));
      this.player.angle += 1.4 * deltaSeconds;
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

    const name = input.value.trim() || this.currentUser?.username || "";

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

  private bindMenu() {
    this.grid.getMenuButton()?.addEventListener("click", () => {
      this.menuView = "main";
      this.isRaceActive = false;
      this.renderMenu();
    });

    this.grid.getMenuOverlay()?.addEventListener("submit", (event) => {
      event.preventDefault();

      const form = event.target;

      if (!(form instanceof HTMLFormElement)) return;

      if (form.dataset.action === "login") {
        this.login(form);
        this.renderMenu();
      }

      if (form.dataset.action === "register") {
        this.register(form);
        this.renderMenu();
      }

      if (form.dataset.action === "customize") {
        this.saveCustomization(form);
      }

      if (form.dataset.action === "join-room") {
        this.joinLobby(this.getFormValue(form, "roomCode"));
        this.renderMenu();
      }
    });

    this.grid.getMenuOverlay()?.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement
        ? event.target.closest<HTMLButtonElement>("button[data-action]")
        : null;

      if (!target) return;

      const action = target.dataset.action;

      if (!action) return;

      if (action === "main") this.menuView = "main";
      if (action === "lobby" && this.lobbyCode) this.menuView = "lobby";
      if (action === "singleplayer") {
        this.playMode = "singleplayer";
        this.menuView = "singleplayer";
      }
      if (action === "multiplayer") this.menuView = "multiplayer";
      if (action === "host-room") this.hostLobby();
      if (action === "leave-lobby") this.leaveLobby();
      if (action === "levels") this.menuView = "levels";
      if (action === "customize") this.menuView = "customize";
      if (action === "show-register") this.authMode = "register";
      if (action === "show-login") this.authMode = "login";
      if (action === "logout") this.logout();
      if (action === "start-race") void this.startSelectedLevel();
      if (action === "load-level") {
        const levelId = target.dataset.levelId;

        if (levelId) void this.selectLevel(levelId);
      }

      this.renderMenu();
    });
  }

  private renderMenu() {
    const overlay = this.grid.getMenuOverlay();

    if (!overlay) return;

    overlay.hidden = this.menuView === "hidden";

    if (this.menuView === "hidden") {
      overlay.innerHTML = "";
      return;
    }

    overlay.innerHTML = `
      <section class="main-menu">
        <div class="menu-title">
          <h1>Letter Racer</h1>
          <p>${this.currentUser ? `signed in as ${this.escapeHtml(this.currentUser.username)}` : "sign in to race"}</p>
        </div>
        ${this.renderMenuView()}
      </section>
    `;
  }

  private renderMenuView() {
    if (this.menuView === "auth") {
      return `
        ${this.renderAuthPanel()}
        <p class="menu-message">${this.escapeHtml(this.menuMessage)}</p>
      `;
    }

    if (this.menuView === "singleplayer") {
      return `
        <nav class="menu-actions">
          <button type="button" data-action="start-race">race current level</button>
          <button type="button" data-action="levels">levels</button>
          <button type="button" data-action="main">back</button>
        </nav>
        <p class="menu-hint">singleplayer runs locally and does not join a room.</p>
      `;
    }

    if (this.menuView === "multiplayer") {
      return `
        <nav class="menu-actions">
          <button type="button" data-action="host-room">host server</button>
        </nav>
        <form class="menu-form room-form" data-action="join-room">
          <h2>join server</h2>
          <input name="roomCode" type="text" maxlength="4" placeholder="code" autocomplete="off" />
          <button type="submit">join</button>
        </form>
        <nav class="menu-actions compact">
          <button type="button" data-action="main">back</button>
        </nav>
        <p class="menu-hint">room codes are four letters. share the code with friends.</p>
      `;
    }

    if (this.menuView === "lobby") {
      return `
        <section class="lobby-panel">
          <h2>${this.isLobbyHost ? "hosting server" : "joined server"}</h2>
          <div class="room-code">${this.escapeHtml(this.lobbyCode)}</div>
          <p>level: ${this.escapeHtml(this.world.getCurrentLevel().name)}</p>
        </section>
        <nav class="menu-actions">
          ${this.isLobbyHost ? `<button type="button" data-action="levels">choose level</button>` : ""}
          <button type="button" data-action="start-race">race</button>
          <button type="button" data-action="leave-lobby">leave server</button>
        </nav>
      `;
    }

    if (this.menuView === "levels") {
      return `
        <div class="level-list">
          ${this.world.getLevels().map((level) => `
            <button
              type="button"
              data-action="load-level"
              data-level-id="${this.escapeHtml(level.id)}"
              class="${level.id === this.world.getCurrentLevel().id ? "is-active" : ""}"
            >
              <strong>${this.escapeHtml(level.name)}</strong>
              <span>${this.escapeHtml(level.description)}</span>
            </button>
          `).join("")}
        </div>
        <nav class="menu-actions compact">
          <button type="button" data-action="${this.playMode === "multiplayer" ? "lobby" : "singleplayer"}">
            back
          </button>
        </nav>
      `;
    }

    if (this.menuView === "customize") {
      return `
        <form class="menu-form customize-form" data-action="customize">
          <h2>customize</h2>
          <label>
            car text
            <input name="carLabel" type="text" maxlength="8" value="${this.escapeHtml(this.settings.playerLabel)}" />
          </label>
          <label>
            car color
            <input name="carColor" type="color" value="${this.settings.playerColor}" />
          </label>
          <div class="car-preview" style="color: ${this.settings.playerColor};">${this.escapeHtml(this.settings.playerLabel)}</div>
          <button type="submit">save design</button>
          <button type="button" data-action="main">back</button>
        </form>
        <p class="menu-message">${this.escapeHtml(this.menuMessage)}</p>
      `;
    }

    return `
      <nav class="menu-actions">
        <button type="button" data-action="singleplayer">singleplayer</button>
        <button type="button" data-action="multiplayer">multiplayer</button>
        <button type="button" data-action="customize">customize</button>
        <button type="button" data-action="logout">logout</button>
      </nav>
      <p class="menu-hint">host a room for friends or run a local level.</p>
    `;
  }

  private login(form: HTMLFormElement) {
    const username = this.getFormValue(form, "username");
    const password = this.getFormValue(form, "password");
    const user = this.getStoredUsers().find((candidate) => candidate.username === username);

    if (!user || user.password !== password) {
      this.menuMessage = "wrong username or password";
      this.renderMenu();
      return;
    }

    this.currentUser = user;
    localStorage.setItem(CURRENT_USER_KEY, user.username);
    this.applyCurrentUserCustomization();
    this.menuMessage = "";
    this.menuView = "main";
  }

  private register(form: HTMLFormElement) {
    const username = this.getFormValue(form, "username");
    const password = this.getFormValue(form, "password");
    const users = this.getStoredUsers();

    if (username.length < 2 || password.length < 2) {
      this.menuMessage = "use at least 2 characters";
      this.renderMenu();
      return;
    }

    if (users.some((user) => user.username === username)) {
      this.menuMessage = "username already exists";
      this.renderMenu();
      return;
    }

    const user: StoredUser = {
      username,
      password,
      carLabel: this.settings.playerLabel,
      carColor: this.settings.playerColor,
    };

    users.push(user);
    this.saveStoredUsers(users);
    this.currentUser = user;
    localStorage.setItem(CURRENT_USER_KEY, user.username);
    this.menuMessage = "";
    this.menuView = "main";
  }

  private saveCustomization(form: HTMLFormElement) {
    const carLabel = this.getFormValue(form, "carLabel").slice(0, 8) || "car";
    const carColor = this.getFormValue(form, "carColor") || "#ffcf33";

    this.settings.playerLabel = carLabel;
    this.settings.playerColor = carColor;
    this.grid.getPlayfield()?.style.setProperty("--player-color", carColor);

    if (this.currentUser) {
      this.currentUser = {
        ...this.currentUser,
        carLabel,
        carColor,
      };
      this.saveStoredUsers(this.getStoredUsers().map((user) => (
        user.username === this.currentUser!.username ? this.currentUser! : user
      )));
    }

    this.menuMessage = "design saved";
    this.renderPlayer();
    this.renderMenu();
  }

  private logout() {
    localStorage.removeItem(CURRENT_USER_KEY);
    this.currentUser = null;
    this.isRaceActive = false;
    this.leaveLobby();
    this.menuMessage = "";
    this.menuView = "auth";
    this.authMode = "login";
  }

  private enterRace(connectMultiplayer: boolean) {
    this.menuView = "hidden";
    this.isRaceActive = true;

    if (connectMultiplayer && !this.isMultiplayerConnected) {
      this.multiplayer.connect();
      this.isMultiplayerConnected = true;
    }
  }

  private async selectLevel(levelId: string) {
    this.selectedLevelId = levelId;

    if (this.playMode === "multiplayer" && this.lobbyCode && this.isLobbyHost) {
      await this.loadLevel(levelId, false);
      this.multiplayer.setLevel(levelId);
      this.menuView = "lobby";
      this.renderMenu();
      return;
    }

    await this.loadLevel(levelId, true);
  }

  private async startSelectedLevel() {
    await this.loadLevel(this.selectedLevelId, true);
  }

  private async loadLevel(levelId: string, enterAfterLoad: boolean) {
    this.loading = {
      active: true,
      message: "loading level",
    };
    this.renderLoading();
    await this.delay(520);

    if (!this.world.setLevel(levelId)) {
      this.loading = {
        active: false,
        message: "",
      };
      this.menuMessage = "level unavailable";
      this.renderLoading();
      this.renderMenu();
      return;
    }

    this.selectedLevelId = levelId;
    this.resetRaceState();
    this.renderLayout();
    await this.delay(180);
    this.loading = {
      active: false,
      message: "",
    };
    this.renderLoading();
    if (enterAfterLoad) {
      this.enterRace(this.playMode === "multiplayer");
    }
    this.renderMenu();
  }

  private hostLobby() {
    this.playMode = "multiplayer";
    this.lobbyCode = this.generateRoomCode();
    this.isLobbyHost = true;
    this.isRaceActive = false;
    this.connectToLobby();
    this.multiplayer.setLevel(this.selectedLevelId);
    this.menuView = "lobby";
  }

  private joinLobby(roomCode: string) {
    const normalized = roomCode.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);

    if (normalized.length !== 4) {
      this.menuMessage = "enter a 4 letter code";
      return;
    }

    this.playMode = "multiplayer";
    this.lobbyCode = normalized;
    this.isLobbyHost = false;
    this.isRaceActive = false;
    this.connectToLobby();
    this.menuMessage = "";
    this.menuView = "lobby";
  }

  private leaveLobby() {
    this.multiplayer.disconnect();
    this.isMultiplayerConnected = false;
    this.lobbyCode = "";
    this.isLobbyHost = false;
    this.playMode = "singleplayer";
    this.renderRemotePlayers([]);
  }

  private connectToLobby() {
    this.multiplayer.configure({
      roomId: this.lobbyCode,
      playerName: this.currentUser?.username || "player",
      onLevelChange: (levelId) => {
        if (this.isLobbyHost || levelId === this.world.getCurrentLevel().id) return;

        this.selectedLevelId = levelId;
        void this.loadLevel(levelId, false);
      },
    });
    this.multiplayer.connect();
    this.isMultiplayerConnected = true;
  }

  private generateRoomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";

    return Array.from({ length: 4 }, () => (
      alphabet[Math.floor(Math.random() * alphabet.length)]
    )).join("");
  }

  private resetRaceState() {
    this.world.resetRaceProgress();
    this.player.placeAt(this.world.spawn.x, this.world.spawn.y);
    this.player.velocity.set(0, 0);
    this.player.localVector.set(0, 0);
    this.player.speed = 0;
    this.raceTimer = {
      status: "idle",
      startTime: 0,
      finalElapsed: 0,
    };
    this.hasSavedCurrentScore = false;
    this.isPlayerPlaced = true;

    const playfield = this.grid.getPlayfield();

    if (playfield) {
      this.camera.follow(this.player, playfield.getBoundingClientRect(), this.world.getBounds());
      this.camera.snapToTarget();
    }
  }

  private resolveHoleFall() {
    const footprint = this.player.getFootprint();
    const shouldReset = this.world.isInHole(this.player.x, this.player.y, PLAYER_RADIUS) ||
      this.world.isFootprintFullyInVoid(footprint);

    if (!shouldReset) return;

    this.resetRaceState();
    this.renderPlayer();
    this.renderRaceHud();
  }

  private renderLoading() {
    const overlay = this.grid.getLoadingOverlay();

    if (!overlay) return;

    overlay.hidden = !this.loading.active;
    overlay.innerHTML = this.loading.active
      ? `
        <div class="loading-box">
          <span class="loading-spinner"></span>
          <strong>${this.escapeHtml(this.loading.message)}</strong>
        </div>
      `
      : "";
  }

  private renderAuthPanel() {
    const isRegister = this.authMode === "register";

    return `
      <form class="menu-form auth-form" data-action="${isRegister ? "register" : "login"}">
        <h2>${isRegister ? "register" : "login"}</h2>
        <input name="username" type="text" placeholder="username" autocomplete="username" />
        <input
          name="password"
          type="password"
          placeholder="password"
          autocomplete="${isRegister ? "new-password" : "current-password"}"
        />
        <button type="submit">${isRegister ? "create account" : "login"}</button>
        <p class="auth-switch">
          ${isRegister ? "Already have an account?" : "Don't have an account yet?"}
          <button type="button" data-action="${isRegister ? "show-login" : "show-register"}">
            ${isRegister ? "Login here" : "Register here"}
          </button>
        </p>
      </form>
    `;
  }

  private loadCurrentUser() {
    const username = localStorage.getItem(CURRENT_USER_KEY);

    if (!username) return null;

    return this.getStoredUsers().find((user) => user.username === username) ?? null;
  }

  private applyCurrentUserCustomization() {
    if (!this.currentUser) return;

    this.settings.playerLabel = this.currentUser.carLabel;
    this.settings.playerColor = this.currentUser.carColor;
  }

  private getStoredUsers(): StoredUser[] {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(USERS_KEY) ?? "[]");

      if (!Array.isArray(value)) return [];

      return value.filter((user): user is StoredUser => (
        user &&
        typeof user === "object" &&
        typeof (user as StoredUser).username === "string" &&
        typeof (user as StoredUser).password === "string" &&
        typeof (user as StoredUser).carLabel === "string" &&
        typeof (user as StoredUser).carColor === "string"
      ));
    } catch {
      return [];
    }
  }

  private saveStoredUsers(users: StoredUser[]) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  private getFormValue(form: HTMLFormElement, name: string) {
    const value = new FormData(form).get(name);

    return typeof value === "string" ? value.trim() : "";
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

  private delay(milliseconds: number) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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
