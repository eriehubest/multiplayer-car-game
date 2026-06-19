import type { GameSettings } from "../config/gameSettings";
import type { PlayerVehicle } from "../entities/PlayerVehicle";
import type { Camera } from "../world/Camera";
import type { WorldMap } from "../world/WorldMap";

type CachedCell = {
  char: string;
  classes: string;
};

export class LetterGrid {
  private activeCellIndex = -1;
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
      const classes = [
        this.sizeClassForCoordinate(column, row),
        tile.kind === "border" ? "tile-border" : "",
        tile.kind === "outside" ? "tile-outside" : "",
      ].filter(Boolean).join(" ");

      return { char: tile.char, classes };
    });

    this.root.innerHTML = `
      <section class="game-shell">
        <section class="playfield" style="
          --letter-color: ${this.settings.letterColor};
          --player-color: ${this.settings.playerColor};
        "
        >
          <section
            class="letter-field"
            style="
              --columns: ${visibleColumns};
              --rows: ${visibleRows};
              width: ${visibleColumns * cell.width}px;
              height: ${visibleRows * cell.height}px;
            "
            aria-label="Random letter game field"
          >
            ${this.renderVisibleCells()}
          </section>
          <span class="player" aria-label="player">▲</span>
          <canvas class="minimap" aria-label="Track minimap"></canvas>
        </section>

        ${debugPanelMarkup}
      </section>
    `;

    this.activeCellIndex = -1;
    this.updateCameraOffset(camera);
  }

  getPlayfield() {
    return this.root.querySelector<HTMLElement>(".playfield");
  }

  getPlayerElement() {
    return this.root.querySelector<HTMLElement>(".player");
  }

  getMinimapElement() {
    return this.root.querySelector<HTMLCanvasElement>(".minimap");
  }

  getCellSize() {
    return {
      width: this.viewport.cellWidth,
      height: this.viewport.cellHeight,
    };
  }

  updateCameraOffset(camera: Camera) {
    const letterField = this.root.querySelector<HTMLElement>(".letter-field");

    if (!letterField) return;

    const originColumn = Math.floor(camera.x / this.viewport.cellWidth);
    const originRow = Math.floor(camera.y / this.viewport.cellHeight);

    if (
      originColumn !== this.viewport.originColumn ||
      originRow !== this.viewport.originRow
    ) {
      this.viewport.originColumn = originColumn;
      this.viewport.originRow = originRow;
      letterField.innerHTML = this.renderVisibleCells();
      this.activeCellIndex = -1;
    }

    const offsetX = camera.x - this.viewport.originColumn * this.viewport.cellWidth;
    const offsetY = camera.y - this.viewport.originRow * this.viewport.cellHeight;

    letterField.style.transform = `translate(${-offsetX}px, ${-offsetY}px)`;
  }

  updateActiveLetter(player: PlayerVehicle) {
    const letterField = this.root.querySelector<HTMLElement>(".letter-field");

    if (!letterField) return;

    const worldColumn = Math.floor(player.x / this.viewport.cellWidth);
    const worldRow = Math.floor(player.y / this.viewport.cellHeight);
    const visibleColumn = worldColumn - this.viewport.originColumn;
    const visibleRow = worldRow - this.viewport.originRow;

    if (
      visibleColumn < 0 ||
      visibleRow < 0 ||
      visibleColumn >= this.viewport.columns ||
      visibleRow >= this.viewport.rows
    ) {
      letterField.children[this.activeCellIndex]?.classList.remove("under-player");
      this.activeCellIndex = -1;
      return;
    }

    const nextIndex = visibleRow * this.viewport.columns + visibleColumn;

    if (nextIndex === this.activeCellIndex) return;

    letterField.children[this.activeCellIndex]?.classList.remove("under-player");
    letterField.children[nextIndex]?.classList.add("under-player");
    this.activeCellIndex = nextIndex;
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

  private sizeClassForCoordinate(x: number, y: number) {
    const sizeClasses = ["size-sm", "size-md", "size-lg"];
    return sizeClasses[Math.abs(x * 7 + y * 13 + x * y) % sizeClasses.length];
  }

  private renderVisibleCells() {
    const cells: string[] = [];

    for (let row = 0; row < this.viewport.rows; row += 1) {
      for (let column = 0; column < this.viewport.columns; column += 1) {
        const worldColumn = this.viewport.originColumn + column;
        const worldRow = this.viewport.originRow + row;
        const cachedCell = this.cachedCells[worldRow * this.map.columns + worldColumn];

        if (!cachedCell) {
          cells.push(`<span class="tile-outside"> </span>`);
          continue;
        }

        cells.push(`<span class="${cachedCell.classes}">${cachedCell.char}</span>`);
      }
    }

    return cells.join("");
  }
}
