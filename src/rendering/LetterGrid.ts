import type { GameSettings } from "../config/gameSettings";
import type { PlayerVehicle } from "../entities/PlayerVehicle";
import type { Camera } from "../world/Camera";
import type { WorldMap, WorldTile } from "../world/WorldMap";

type CachedCell = {
  char: string;
  kind: WorldTile["kind"];
  size: number;
};

export class LetterGrid {
  private activeCellIndex = {
    column: -1,
    row: -1,
  };
  private viewport = {
    columns: 0,
    rows: 0,
    cellWidth: 1,
    cellHeight: 1,
    originColumn: 0,
    originRow: 0,
  };
  private map = {
    columns: 0,
    rows: 0,
  };
  private cachedCells: CachedCell[] = [];
  private lastCamera: Camera | null = null;
  private world: WorldMap | null = null;

  constructor(
    private root: HTMLElement,
    private settings: GameSettings,
  ) {}

  render(
    debugPanelMarkup: string,
    world: WorldMap,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ) {
    const cell = this.measureCell();
    const mapColumns = Math.ceil(world.width / cell.width);
    const mapRows = Math.ceil(world.height / cell.height);
    const visibleColumns = Math.ceil(viewportWidth / cell.width) + 2;
    const visibleRows = Math.ceil(viewportHeight / cell.height) + 2;

    this.world = world;
    this.map = {
      columns: mapColumns,
      rows: mapRows,
    };
    this.viewport = {
      columns: visibleColumns,
      rows: visibleRows,
      cellWidth: cell.width,
      cellHeight: cell.height,
      originColumn: Math.floor(camera.x / cell.width),
      originRow: Math.floor(camera.y / cell.height),
    };
    this.cachedCells = Array.from({ length: mapColumns * mapRows }, (_, index) => {
      const column = index % mapColumns;
      const row = Math.floor(index / mapColumns);
      const tile = world.getTile(column, row, cell.width, cell.height);

      return {
        char: tile.char,
        kind: tile.kind,
        size: this.fontSizeForCoordinate(column, row),
      };
    });

    this.root.innerHTML = `
      <section class="game-shell">
        <section class="playfield" style="
          --letter-color: ${this.settings.letterColor};
          --player-color: ${this.settings.playerColor};
        "
        >
          <canvas class="letter-canvas" aria-label="Random letter game field"></canvas>
          <section class="remote-players" aria-label="remote players"></section>
          <span class="player" aria-label="player">car</span>
          <canvas class="minimap" aria-label="Track minimap"></canvas>
          <section class="race-hud" aria-label="Race status"></section>
          <button class="leaderboard-button" type="button">leaderboard</button>
          <section class="leaderboard-panel" aria-label="Leaderboard" hidden>
            <div class="leaderboard-card">
              <div class="leaderboard-header">
                <h2>leaderboard</h2>
                <button class="leaderboard-close" type="button" aria-label="Close leaderboard">x</button>
              </div>
              <ol class="leaderboard-list"></ol>
              <form class="leaderboard-form">
                <input class="leaderboard-name" type="text" maxlength="18" placeholder="name" autocomplete="name" />
                <button type="submit">save score</button>
              </form>
              <p class="leaderboard-note"></p>
            </div>
          </section>
        </section>

        ${debugPanelMarkup}
      </section>
    `;

    this.activeCellIndex = {
      column: -1,
      row: -1,
    };
    this.updateCameraOffset(camera);
  }

  getPlayfield() {
    return this.root.querySelector<HTMLElement>(".playfield");
  }

  getPlayerElement() {
    return this.root.querySelector<HTMLElement>(".player");
  }

  getRemotePlayersElement() {
    return this.root.querySelector<HTMLElement>(".remote-players");
  }

  getMinimapElement() {
    return this.root.querySelector<HTMLCanvasElement>(".minimap");
  }

  getRaceHudElement() {
    return this.root.querySelector<HTMLElement>(".race-hud");
  }

  getLeaderboardButton() {
    return this.root.querySelector<HTMLButtonElement>(".leaderboard-button");
  }

  getLeaderboardPanel() {
    return this.root.querySelector<HTMLElement>(".leaderboard-panel");
  }

  getLeaderboardCloseButton() {
    return this.root.querySelector<HTMLButtonElement>(".leaderboard-close");
  }

  getLeaderboardForm() {
    return this.root.querySelector<HTMLFormElement>(".leaderboard-form");
  }

  getLeaderboardNameInput() {
    return this.root.querySelector<HTMLInputElement>(".leaderboard-name");
  }

  getLeaderboardList() {
    return this.root.querySelector<HTMLOListElement>(".leaderboard-list");
  }

  getLeaderboardNote() {
    return this.root.querySelector<HTMLElement>(".leaderboard-note");
  }

  getCellSize() {
    return {
      width: this.viewport.cellWidth,
      height: this.viewport.cellHeight,
    };
  }

  updateCameraOffset(camera: Camera) {
    this.lastCamera = camera;
    this.viewport.originColumn = Math.floor(camera.x / this.viewport.cellWidth);
    this.viewport.originRow = Math.floor(camera.y / this.viewport.cellHeight);
    this.renderCanvas(camera);
  }

  updateActiveLetter(player: PlayerVehicle) {
    const worldColumn = Math.floor(player.x / this.viewport.cellWidth);
    const worldRow = Math.floor(player.y / this.viewport.cellHeight);

    if (
      worldColumn === this.activeCellIndex.column &&
      worldRow === this.activeCellIndex.row
    ) return;

    this.activeCellIndex = {
      column: worldColumn,
      row: worldRow,
    };

    if (this.lastCamera) {
      this.renderCanvas(this.lastCamera);
    }
  }

  private measureCell() {
    const probe = document.createElement("span");
    probe.className = "cell-probe";
    probe.textContent = "m";
    this.root.append(probe);

    const rect = probe.getBoundingClientRect();
    probe.remove();

    return {
      width: Math.max(rect.width, 1),
      height: Math.max(rect.height, 1),
    };
  }

  private fontSizeForCoordinate(x: number, y: number) {
    const sizes = [28, 30, 32];
    return sizes[Math.abs(x * 7 + y * 13 + x * y) % sizes.length];
  }

  private renderCanvas(camera: Camera) {
    const canvas = this.root.querySelector<HTMLCanvasElement>(".letter-canvas");
    const playfield = this.getPlayfield();

    if (!canvas || !playfield || !this.world) return;

    const pixelRatio = window.devicePixelRatio || 1;
    const width = playfield.clientWidth;
    const height = playfield.clientHeight;
    const targetWidth = Math.round(width * pixelRatio);
    const targetHeight = Math.round(height * pixelRatio);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const startColumn = Math.max(0, Math.floor(camera.x / this.viewport.cellWidth) - 1);
    const endColumn = Math.min(
      this.map.columns - 1,
      Math.ceil((camera.x + width) / this.viewport.cellWidth) + 1,
    );
    const startRow = Math.max(0, Math.floor(camera.y / this.viewport.cellHeight) - 1);
    const endRow = Math.min(
      this.map.rows - 1,
      Math.ceil((camera.y + height) / this.viewport.cellHeight) + 1,
    );

    for (let row = startRow; row <= endRow; row += 1) {
      for (let column = startColumn; column <= endColumn; column += 1) {
        const cell = this.cachedCells[row * this.map.columns + column];

        if (!cell) continue;

        const overlay = this.world.getRaceOverlayTile(
          column,
          row,
          this.viewport.cellWidth,
          this.viewport.cellHeight,
        );
        const x = column * this.viewport.cellWidth - camera.x + this.viewport.cellWidth / 2;
        const y = row * this.viewport.cellHeight - camera.y + this.viewport.cellHeight / 2;
        const isActive = column === this.activeCellIndex.column && row === this.activeCellIndex.row;

        this.drawCell(
          ctx,
          overlay ? { ...overlay, size: cell.size } : cell,
          x,
          y,
          isActive,
        );
      }
    }
  }

  private drawCell(
    ctx: CanvasRenderingContext2D,
    cell: CachedCell,
    x: number,
    y: number,
    isActive: boolean,
  ) {
    ctx.font = `${cell.size}px "Courier New", Courier, ui-monospace, monospace`;
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";

    if (isActive) {
      ctx.fillStyle = "#8f98a5";
      ctx.shadowColor = "rgb(143 152 165 / 0.8)";
      ctx.shadowBlur = 8;
    } else if (cell.kind === "checkpoint") {
      ctx.fillStyle = "#45b8ff";
      ctx.shadowColor = "rgb(69 184 255 / 0.85)";
      ctx.shadowBlur = 10;
    } else if (cell.kind === "start") {
      ctx.fillStyle = "#58ff57";
      ctx.shadowColor = "rgb(88 255 87 / 0.85)";
      ctx.shadowBlur = 10;
    } else if (cell.kind === "finish") {
      ctx.fillStyle = "#c8ff4d";
      ctx.shadowColor = "rgb(200 255 77 / 0.9)";
      ctx.shadowBlur = 12;
    } else if (cell.kind === "border") {
      ctx.fillStyle = "#ff4d5e";
      ctx.shadowColor = "rgb(255 77 94 / 0.85)";
      ctx.shadowBlur = 8;
    } else if (cell.kind === "outside") {
      ctx.fillStyle = "#252b33";
    } else {
      ctx.fillStyle = this.settings.letterColor;
    }

    ctx.fillText(cell.char, x, y);
  }
}
