import { Vector2 } from "../math/Vector2";
import type { CarFootprint } from "../entities/PlayerVehicle";

const VOIDTEXT = "void";
const TRACKTEXT = "TRACK";
const WALLTEXT = "WALL";
const CHECKPOINTTEXT = "CHECKPOINT";
const STARTINGLINETEXT = "STARTINGLINE";
const FINISHLINETEXT = "FINISHLINE";
const HOLETEXT = "HOLE";
const BOOSTTEXT = "BOOST";
const TRAPTEXT = "TRAP";
export const BORDER_THICKNESS = 34;
export const PLAYER_RADIUS = BORDER_THICKNESS / 2;

const SCALE = BORDER_THICKNESS / 2;
const ROAD_HALF_WIDTH = SCALE * 9;
const CHALLENGE_ROAD_HALF_WIDTH = BORDER_THICKNESS;
const TRACK_PADDING = SCALE * 12;

type Point = {
  x: number;
  y: number;
};

export type WorldTile = {
  char: string;
  kind: "letter" | "border" | "outside" | "checkpoint" | "start" | "finish" | "hole" | "boost" | "trap";
};

export type CircleResolution = {
  collided: boolean;
  x: number;
  y: number;
  normal: Vector2;
};

type RaceGate = {
  center: Point;
  axis: "horizontal" | "vertical";
  halfLength: number;
  halfThickness: number;
  hitboxHalfThickness: number;
};

type Hole = {
  center: Point;
  radius: number;
};

type HazardZone = {
  center: Point;
  radius: number;
  kind: "boost" | "trap";
};

type LevelDefinition = {
  id: string;
  name: string;
  description: string;
  mode: "race" | "stars";
  roadHalfWidth: number;
  hasWalls: boolean;
  points: Point[];
  spawn: Point;
  startLine: Omit<RaceGate, "center"> & { center: Point };
  checkpoints: Array<Omit<RaceGate, "center"> & { center: Point }>;
  holes: Hole[];
  hazards: HazardZone[];
};

export type RaceGateView = RaceGate & {
  kind: "checkpoint" | "start" | "finish";
};

export type LevelSummary = {
  id: string;
  name: string;
  description: string;
  mode: "race" | "stars";
};

export class WorldMap {
  width = 0;
  height = 0;
  spawn = {
    x: 0,
    y: 0,
  };

  private trackPoints: Point[] = [];
  private startLine: RaceGate | null = null;
  private checkpoints: RaceGate[] = [];
  private holes: Hole[] = [];
  private hazards: HazardZone[] = [];
  private activeCheckpointIndex = 0;
  private activeLevelId = "loop";
  private roadHalfWidth = ROAD_HALF_WIDTH;

  constructor() {
    this.buildTrack();
  }

  resizeToViewport(_viewportWidth: number, _viewportHeight: number) {
    this.buildTrack();
  }

  getTile(cellX: number, cellY: number, cellWidth: number, cellHeight: number): WorldTile {
    const x = (cellX + 0.5) * cellWidth;
    const y = (cellY + 0.5) * cellHeight;

    if (x < 0 || x > this.width || y < 0 || y > this.height) {
      return { char: this.getVoidCharacter(cellX, cellY), kind: "outside" };
    }

    const distance = this.distanceToTrack(x, y);

    if (distance <= this.roadHalfWidth && this.isPointInsideHole(x, y)) {
      return { char: this.holeCharacterForCoordinate(cellX, cellY), kind: "hole" };
    }

    if (distance <= this.roadHalfWidth) {
      const hazard = this.getHazardAtPoint(x, y);

      if (hazard?.kind === "boost") {
        return { char: this.effectCharacterForCoordinate(cellX, cellY, BOOSTTEXT), kind: "boost" };
      }

      if (hazard?.kind === "trap") {
        return { char: this.effectCharacterForCoordinate(cellX, cellY, TRAPTEXT), kind: "trap" };
      }

      return { char: this.letterForCoordinate(cellX, cellY), kind: "letter" };
    }

    if (this.getActiveLevel().hasWalls && distance <= this.roadHalfWidth + BORDER_THICKNESS) {
      return { char: this.wallCharacterForCoordinate(cellX, cellY), kind: "border" };
    }

    return { char: this.getVoidCharacter(cellX, cellY), kind: "outside" };
  }

  getRaceOverlayTile(cellX: number, cellY: number, cellWidth: number, cellHeight: number): WorldTile | null {
    const x = (cellX + 0.5) * cellWidth;
    const y = (cellY + 0.5) * cellHeight;
    const lineText = this.isFinished() ? FINISHLINETEXT : STARTINGLINETEXT;
    const baseTile = this.getTile(cellX, cellY, cellWidth, cellHeight);

    if (baseTile.kind !== "letter") return null;

    if (this.startLine && this.isPointOnRaceGate(x, y, this.startLine, cellWidth, cellHeight)) {
      return {
        char: this.textCharacterForGate(cellX, cellY, cellWidth, cellHeight, this.startLine, lineText),
        kind: this.isFinished() ? "finish" : "start",
      };
    }

    const checkpoint = this.checkpoints[this.activeCheckpointIndex];

    if (checkpoint && this.isPointOnRaceGate(x, y, checkpoint, cellWidth, cellHeight)) {
      return {
        char: this.textCharacterForGate(cellX, cellY, cellWidth, cellHeight, checkpoint, CHECKPOINTTEXT),
        kind: "checkpoint",
      };
    }

    return null;
  }

  getBounds() {
    return {
      minX: 0,
      minY: 0,
      maxX: this.width,
      maxY: this.height,
    };
  }

  getPlayableBounds() {
    return this.getBounds();
  }

  getRoadHalfWidth() {
    return this.roadHalfWidth;
  }

  getTrackPoints() {
    return this.trackPoints.map((point) => ({ ...point }));
  }

  getHoles() {
    return this.holes.map((hole) => ({
      center: { ...hole.center },
      radius: hole.radius,
    }));
  }

  getHazards() {
    return this.hazards.map((hazard) => ({
      center: { ...hazard.center },
      radius: hazard.radius,
      kind: hazard.kind,
    }));
  }

  getLevels(): LevelSummary[] {
    return LEVELS.map((level) => ({
      id: level.id,
      name: level.name,
      description: level.description,
      mode: level.mode,
    }));
  }

  isStarArena() {
    return this.getActiveLevel().mode === "stars";
  }

  getCurrentLevel() {
    return this.getLevels().find((level) => level.id === this.activeLevelId) ?? this.getLevels()[0];
  }

  setLevel(levelId: string) {
    if (!LEVELS.some((level) => level.id === levelId)) return false;

    this.activeLevelId = levelId;
    this.resetRaceProgress();
    this.buildTrack();
    return true;
  }

  resetRaceProgress() {
    this.activeCheckpointIndex = 0;
  }

  getCheckpointProgress() {
    return {
      active: Math.min(this.activeCheckpointIndex + 1, this.checkpoints.length),
      completed: this.activeCheckpointIndex,
      total: this.checkpoints.length,
      finished: this.isFinished(),
    };
  }

  getVisibleRaceGates(): RaceGateView[] {
    const gates: RaceGateView[] = [];

    if (this.startLine) {
      gates.push({
        ...this.copyGate(this.startLine),
        kind: this.isFinished() ? "finish" : "start",
      });
    }

    const checkpoint = this.checkpoints[this.activeCheckpointIndex];

    if (checkpoint) {
      gates.push({
        ...this.copyGate(checkpoint),
        kind: "checkpoint",
      });
    }

    return gates;
  }

  updateRaceProgress(x: number, y: number, radius: number) {
    const checkpoint = this.checkpoints[this.activeCheckpointIndex];

    if (!checkpoint || !this.isPointInsideGate(x, y, checkpoint, radius, true)) return false;

    this.activeCheckpointIndex += 1;
    return true;
  }

  isOnStartLine(x: number, y: number, radius: number) {
    return Boolean(
      this.startLine && this.isPointInsideGate(x, y, this.startLine, radius, true),
    );
  }

  isFinished() {
    return this.activeCheckpointIndex >= this.checkpoints.length;
  }

  isInHole(x: number, y: number, radius: number) {
    return this.holes.some((hole) => (
      Math.hypot(x - hole.center.x, y - hole.center.y) <= hole.radius + radius * 0.25
    ));
  }

  isFootprintInHole(footprint: CarFootprint) {
    const samplePoints = [footprint.center, ...footprint.corners];

    return samplePoints.every((point) => this.isPointInsideHole(point.x, point.y));
  }

  isFootprintFullyInVoid(footprint: CarFootprint) {
    if (this.getActiveLevel().hasWalls) return false;

    const samplePoints = [footprint.center, ...footprint.corners];

    return samplePoints.every((point) => this.distanceToTrack(point.x, point.y) > this.roadHalfWidth);
  }

  getSurfaceEffect(x: number, y: number) {
    return this.getHazardAtPoint(x, y)?.kind ?? "normal";
  }

  resolveCircle(x: number, y: number, radius: number): CircleResolution {
    const nearest = this.nearestPointOnTrack(x, y);
    const dx = x - nearest.x;
    const dy = y - nearest.y;
    const distance = Math.hypot(dx, dy);
    const maxDistance = this.roadHalfWidth - radius;

    if (distance <= maxDistance) {
      return { collided: false, x, y, normal: new Vector2() };
    }

    const normal = distance > 0
      ? new Vector2(dx / distance, dy / distance)
      : Vector2.fromAngle(0);

    return {
      collided: true,
      x: nearest.x + normal.x * maxDistance,
      y: nearest.y + normal.y * maxDistance,
      normal,
    };
  }

  resolveCircleAgainstBlocks(
    x: number,
    y: number,
    radius: number,
    cellWidth: number,
    cellHeight: number,
  ): CircleResolution {
    const position = new Vector2(x, y);
    const normalSum = new Vector2();
    let collided = false;

    for (let pass = 0; pass < 3; pass += 1) {
      const minCellX = Math.floor((position.x - radius) / cellWidth);
      const maxCellX = Math.floor((position.x + radius) / cellWidth);
      const minCellY = Math.floor((position.y - radius) / cellHeight);
      const maxCellY = Math.floor((position.y + radius) / cellHeight);

      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
          const tile = this.getTile(cellX, cellY, cellWidth, cellHeight);

          if (tile.kind !== "border") continue;

          const left = cellX * cellWidth;
          const right = left + cellWidth;
          const top = cellY * cellHeight;
          const bottom = top + cellHeight;
          const closestX = Math.min(right, Math.max(left, position.x));
          const closestY = Math.min(bottom, Math.max(top, position.y));
          let dx = position.x - closestX;
          let dy = position.y - closestY;
          let distance = Math.hypot(dx, dy);

          if (distance >= radius) continue;

          if (distance === 0) {
            dx = position.x - (left + right) / 2;
            dy = position.y - (top + bottom) / 2;
            distance = Math.hypot(dx, dy) || 1;
          }

          const normal = new Vector2(dx / distance, dy / distance);
          const penetration = radius - distance;

          position.add(normal.clone().scale(penetration));
          normalSum.add(normal);
          collided = true;
        }
      }
    }

    if (!collided) {
      return { collided: false, x, y, normal: new Vector2() };
    }

    return {
      collided: true,
      x: position.x,
      y: position.y,
      normal: normalSum.normalize(),
    };
  }

  private buildTrack() {
    const level = this.getActiveLevel();

    this.roadHalfWidth = level.roadHalfWidth;
    this.trackPoints = level.points.map((point) => this.scalePoint(point));
    this.holes = level.holes.map((hole) => ({
      center: this.scalePoint(hole.center),
      radius: hole.radius * SCALE,
    }));
    this.hazards = level.hazards.map((hazard) => ({
      center: this.scalePoint(hazard.center),
      radius: hazard.radius * SCALE,
      kind: hazard.kind,
    }));

    const xs = this.trackPoints.map((point) => point.x);
    const ys = this.trackPoints.map((point) => point.y);
    const holeXs = this.holes.flatMap((hole) => [hole.center.x - hole.radius, hole.center.x + hole.radius]);
    const holeYs = this.holes.flatMap((hole) => [hole.center.y - hole.radius, hole.center.y + hole.radius]);
    const hazardXs = this.hazards.flatMap((hazard) => [hazard.center.x - hazard.radius, hazard.center.x + hazard.radius]);
    const hazardYs = this.hazards.flatMap((hazard) => [hazard.center.y - hazard.radius, hazard.center.y + hazard.radius]);

    const edgePadding = TRACK_PADDING + this.roadHalfWidth + BORDER_THICKNESS;

    this.width = Math.max(...xs, ...holeXs, ...hazardXs) + edgePadding;
    this.height = Math.max(...ys, ...holeYs, ...hazardYs) + edgePadding;
    this.spawn = this.scalePoint(level.spawn);
    this.buildRaceGates(level);
  }

  private buildRaceGates(level: LevelDefinition) {
    this.startLine = this.scaleRaceGate(level.startLine);
    this.checkpoints = level.checkpoints.map((checkpoint) => this.scaleRaceGate(checkpoint));
    this.activeCheckpointIndex = Math.min(this.activeCheckpointIndex, this.checkpoints.length);
  }

  private getActiveLevel() {
    return LEVELS.find((level) => level.id === this.activeLevelId) ?? LEVELS[0];
  }

  private scalePoint(point: Point) {
    return {
      x: point.x * SCALE + TRACK_PADDING,
      y: point.y * SCALE + TRACK_PADDING,
    };
  }

  private scaleRaceGate(gate: Omit<RaceGate, "center"> & { center: Point }): RaceGate {
    return {
      center: this.scalePoint(gate.center),
      axis: gate.axis,
      halfLength: gate.halfLength,
      halfThickness: gate.halfThickness,
      hitboxHalfThickness: gate.hitboxHalfThickness,
    };
  }

  private distanceToTrack(x: number, y: number) {
    const nearest = this.nearestPointOnTrack(x, y);

    return Math.hypot(x - nearest.x, y - nearest.y);
  }

  private nearestPointOnTrack(x: number, y: number) {
    let nearest = this.trackPoints[0];
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < this.trackPoints.length - 1; index += 1) {
      const candidate = this.nearestPointOnSegment(
        { x, y },
        this.trackPoints[index],
        this.trackPoints[index + 1],
      );
      const distance = Math.hypot(x - candidate.x, y - candidate.y);

      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  private nearestPointOnSegment(point: Point, start: Point, end: Point) {
    const segmentX = end.x - start.x;
    const segmentY = end.y - start.y;
    const lengthSquared = segmentX * segmentX + segmentY * segmentY;

    if (lengthSquared === 0) return start;

    const t = Math.max(
      0,
      Math.min(1, ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared),
    );

    return {
      x: start.x + segmentX * t,
      y: start.y + segmentY * t,
    };
  }

  private letterForCoordinate(x: number, y: number) {
    const rowOffset = (y * 2) % TRACKTEXT.length;
    const mixed = (x + rowOffset) % TRACKTEXT.length;

    return TRACKTEXT[mixed];
  }

  private wallCharacterForCoordinate(x: number, y: number) {
    const mixed = Math.abs(x + y * 2 + x * y) % WALLTEXT.length;

    return WALLTEXT[mixed];
  }

  private isPointInsideGate(
    x: number,
    y: number,
    gate: RaceGate,
    padding: number,
    useHitbox = false,
  ) {
    const localX = Math.abs(x - gate.center.x);
    const localY = Math.abs(y - gate.center.y);
    const halfThickness = useHitbox ? gate.hitboxHalfThickness : gate.halfThickness;

    if (gate.axis === "vertical") {
      return (
        localX <= halfThickness + padding &&
        localY <= gate.halfLength + padding
      );
    }

    return (
      localX <= gate.halfLength + padding &&
      localY <= halfThickness + padding
    );
  }

  private isPointOnRaceGate(
    x: number,
    y: number,
    gate: RaceGate,
    cellWidth: number,
    cellHeight: number,
  ) {
    const parallelPadding = Math.max(cellWidth, cellHeight) * 0.5;
    const perpendicularPadding = Math.min(cellWidth, cellHeight) * 0.5;
    const distance = this.distanceToTrack(x, y);

    return (
      distance <= this.roadHalfWidth + Math.max(cellWidth, cellHeight) * 0.25 &&
      this.isPointInsideGateForRender(x, y, gate, parallelPadding, perpendicularPadding)
    );
  }

  private isPointInsideGateForRender(
    x: number,
    y: number,
    gate: RaceGate,
    parallelPadding: number,
    perpendicularPadding: number,
  ) {
    const localX = Math.abs(x - gate.center.x);
    const localY = Math.abs(y - gate.center.y);

    if (gate.axis === "vertical") {
      return (
        localX <= gate.halfThickness + perpendicularPadding &&
        localY <= gate.halfLength + parallelPadding
      );
    }

    return (
      localX <= gate.halfLength + parallelPadding &&
      localY <= gate.halfThickness + perpendicularPadding
    );
  }

  private copyGate(gate: RaceGate): RaceGate {
    return {
      center: { ...gate.center },
      axis: gate.axis,
      halfLength: gate.halfLength,
      halfThickness: gate.halfThickness,
      hitboxHalfThickness: gate.hitboxHalfThickness,
    };
  }

  private textCharacterForGate(
    cellX: number,
    cellY: number,
    cellWidth: number,
    cellHeight: number,
    gate: RaceGate,
    text: string,
  ) {
    const centerCellX = Math.round(gate.center.x / cellWidth);
    const centerCellY = Math.round(gate.center.y / cellHeight);
    const position = gate.axis === "vertical"
      ? cellY - centerCellY
      : cellX - centerCellX;

    return text[Math.abs(position) % text.length];
  }

  private getVoidCharacter(x: number, y: number) {
    const position = ((y * 10) % 7 + x) % VOIDTEXT.length;
    return VOIDTEXT[position];
  }

  private holeCharacterForCoordinate(x: number, y: number) {
    const position = Math.abs(x * 3 + y * 5) % HOLETEXT.length;
    return HOLETEXT[position];
  }

  private effectCharacterForCoordinate(x: number, y: number, text: string) {
    const position = Math.abs(x + y * 2) % text.length;
    return text[position];
  }

  private isPointInsideHole(x: number, y: number) {
    return this.holes.some((hole) => (
      Math.hypot(x - hole.center.x, y - hole.center.y) <= hole.radius
    ));
  }

  private getHazardAtPoint(x: number, y: number) {
    return this.hazards.find((hazard) => (
      Math.hypot(x - hazard.center.x, y - hazard.center.y) <= hazard.radius
    ));
  }
}

const lineHalfLength = ROAD_HALF_WIDTH + BORDER_THICKNESS * 1.2;
const halfThickness = BORDER_THICKNESS * 0.24;
const hitboxHalfThickness = BORDER_THICKNESS * 0.75;

const LEVELS: LevelDefinition[] = [
  {
    id: "loop",
    name: "Grand Loop",
    description: "Wide road, full checkpoint route.",
    mode: "race",
    roadHalfWidth: ROAD_HALF_WIDTH,
    hasWalls: true,
    spawn: { x: 8, y: 60 },
    points: [
      { x: 8, y: 60 },
      { x: 14, y: 30 },
      { x: 52, y: 30 },
      { x: 66, y: 30 },
      { x: 78, y: 16 },
      { x: 100, y: 8 },
      { x: 124, y: 8 },
      { x: 142, y: 23 },
      { x: 172, y: 23 },
      { x: 196, y: 34 },
      { x: 208, y: 54 },
      { x: 208, y: 112 },
      { x: 194, y: 132 },
      { x: 126, y: 132 },
      { x: 106, y: 122 },
      { x: 106, y: 100 },
      { x: 120, y: 90 },
      { x: 166, y: 90 },
      { x: 180, y: 78 },
      { x: 180, y: 66 },
      { x: 168, y: 56 },
      { x: 116, y: 56 },
      { x: 96, y: 66 },
      { x: 86, y: 78 },
      { x: 42, y: 78 },
      { x: 28, y: 90 },
      { x: 28, y: 110 },
      { x: 42, y: 122 },
      { x: 82, y: 122 },
      { x: 96, y: 112 },
      { x: 96, y: 104 },
      { x: 84, y: 100 },
      { x: 50, y: 100 },
      { x: 28, y: 92 },
      { x: 14, y: 78 },
      { x: 8, y: 60 },
      { x: 8, y: 42 },
    ],
    startLine: { center: { x: 9, y: 42 }, axis: "horizontal", halfLength: lineHalfLength, halfThickness, hitboxHalfThickness },
    checkpoints: [
      { center: { x: 36, y: 30 }, axis: "vertical", halfLength: lineHalfLength, halfThickness, hitboxHalfThickness },
      { center: { x: 112, y: 8 }, axis: "vertical", halfLength: lineHalfLength, halfThickness, hitboxHalfThickness },
      { center: { x: 162, y: 23 }, axis: "vertical", halfLength: lineHalfLength, halfThickness, hitboxHalfThickness },
      { center: { x: 208, y: 82 }, axis: "horizontal", halfLength: lineHalfLength, halfThickness, hitboxHalfThickness },
      { center: { x: 135, y: 90 }, axis: "vertical", halfLength: lineHalfLength, halfThickness, hitboxHalfThickness },
      { center: { x: 128, y: 56 }, axis: "vertical", halfLength: lineHalfLength, halfThickness, hitboxHalfThickness },
      { center: { x: 54, y: 120 }, axis: "vertical", halfLength: lineHalfLength, halfThickness, hitboxHalfThickness },
      { center: { x: 54, y: 100 }, axis: "vertical", halfLength: lineHalfLength, halfThickness, hitboxHalfThickness },
    ],
    holes: [],
    hazards: [
      { center: { x: 74, y: 30 }, radius: 2.2, kind: "boost" },
      { center: { x: 154, y: 90 }, radius: 2.4, kind: "boost" },
      { center: { x: 34, y: 106 }, radius: 2.2, kind: "trap" },
    ],
  },
  {
    id: "needle",
    name: "Needle Run",
    description: "Thin bridges, hole traps, short technical route.",
    mode: "race",
    roadHalfWidth: CHALLENGE_ROAD_HALF_WIDTH,
    hasWalls: false,
    spawn: { x: 8, y: 32 },
    points: [
      { x: 8, y: 32 },
      { x: 46, y: 32 },
      { x: 68, y: 18 },
      { x: 96, y: 18 },
      { x: 116, y: 36 },
      { x: 116, y: 64 },
      { x: 90, y: 82 },
      { x: 54, y: 82 },
      { x: 28, y: 64 },
      { x: 28, y: 48 },
      { x: 8, y: 32 },
    ],
    startLine: {
      center: { x: 10, y: 32 },
      axis: "vertical",
      halfLength: BORDER_THICKNESS * 1.3,
      halfThickness,
      hitboxHalfThickness,
    },
    checkpoints: [
      { center: { x: 58, y: 24 }, axis: "vertical", halfLength: BORDER_THICKNESS * 1.2, halfThickness, hitboxHalfThickness },
      { center: { x: 116, y: 50 }, axis: "horizontal", halfLength: BORDER_THICKNESS * 1.2, halfThickness, hitboxHalfThickness },
      { center: { x: 72, y: 82 }, axis: "vertical", halfLength: BORDER_THICKNESS * 1.2, halfThickness, hitboxHalfThickness },
    ],
    holes: [],
    hazards: [
      { center: { x: 48, y: 32 }, radius: 1.8, kind: "boost" },
      { center: { x: 96, y: 18 }, radius: 1.8, kind: "trap" },
      { center: { x: 28, y: 54 }, radius: 1.8, kind: "trap" },
    ],
  },
  {
    id: "skyline",
    name: "Skyline Thread",
    description: "No walls, long one-letter bridges, boosts over gaps.",
    mode: "race",
    roadHalfWidth: CHALLENGE_ROAD_HALF_WIDTH,
    hasWalls: false,
    spawn: { x: 8, y: 48 },
    points: [
      { x: 8, y: 48 },
      { x: 32, y: 48 },
      { x: 52, y: 28 },
      { x: 84, y: 28 },
      { x: 104, y: 52 },
      { x: 134, y: 52 },
      { x: 158, y: 30 },
      { x: 190, y: 30 },
      { x: 214, y: 58 },
      { x: 198, y: 88 },
      { x: 158, y: 88 },
      { x: 126, y: 70 },
      { x: 92, y: 86 },
      { x: 54, y: 82 },
      { x: 26, y: 72 },
      { x: 8, y: 48 },
    ],
    startLine: { center: { x: 10, y: 48 }, axis: "vertical", halfLength: BORDER_THICKNESS * 1.1, halfThickness, hitboxHalfThickness },
    checkpoints: [
      { center: { x: 70, y: 28 }, axis: "vertical", halfLength: BORDER_THICKNESS, halfThickness, hitboxHalfThickness },
      { center: { x: 140, y: 52 }, axis: "vertical", halfLength: BORDER_THICKNESS, halfThickness, hitboxHalfThickness },
      { center: { x: 206, y: 66 }, axis: "horizontal", halfLength: BORDER_THICKNESS, halfThickness, hitboxHalfThickness },
      { center: { x: 112, y: 78 }, axis: "vertical", halfLength: BORDER_THICKNESS, halfThickness, hitboxHalfThickness },
    ],
    holes: [],
    hazards: [
      { center: { x: 38, y: 42 }, radius: 1.6, kind: "boost" },
      { center: { x: 104, y: 52 }, radius: 1.5, kind: "boost" },
      { center: { x: 188, y: 86 }, radius: 1.8, kind: "trap" },
      { center: { x: 64, y: 82 }, radius: 1.8, kind: "trap" },
    ],
  },
  {
    id: "switchback",
    name: "Switchback Sink",
    description: "No walls, tight S bends, holes inside every mistake.",
    mode: "race",
    roadHalfWidth: CHALLENGE_ROAD_HALF_WIDTH,
    hasWalls: false,
    spawn: { x: 10, y: 96 },
    points: [
      { x: 10, y: 96 },
      { x: 38, y: 96 },
      { x: 58, y: 78 },
      { x: 92, y: 78 },
      { x: 112, y: 58 },
      { x: 82, y: 42 },
      { x: 44, y: 42 },
      { x: 30, y: 24 },
      { x: 78, y: 18 },
      { x: 136, y: 22 },
      { x: 162, y: 46 },
      { x: 148, y: 74 },
      { x: 110, y: 96 },
      { x: 64, y: 112 },
      { x: 24, y: 112 },
      { x: 10, y: 96 },
    ],
    startLine: { center: { x: 12, y: 96 }, axis: "vertical", halfLength: BORDER_THICKNESS * 1.15, halfThickness, hitboxHalfThickness },
    checkpoints: [
      { center: { x: 78, y: 78 }, axis: "vertical", halfLength: BORDER_THICKNESS * 1.1, halfThickness, hitboxHalfThickness },
      { center: { x: 58, y: 42 }, axis: "vertical", halfLength: BORDER_THICKNESS * 1.1, halfThickness, hitboxHalfThickness },
      { center: { x: 122, y: 22 }, axis: "vertical", halfLength: BORDER_THICKNESS * 1.1, halfThickness, hitboxHalfThickness },
      { center: { x: 132, y: 84 }, axis: "vertical", halfLength: BORDER_THICKNESS * 1.1, halfThickness, hitboxHalfThickness },
    ],
    holes: [],
    hazards: [
      { center: { x: 46, y: 92 }, radius: 1.8, kind: "trap" },
      { center: { x: 86, y: 20 }, radius: 2.0, kind: "boost" },
      { center: { x: 152, y: 44 }, radius: 1.8, kind: "trap" },
      { center: { x: 42, y: 112 }, radius: 1.8, kind: "boost" },
    ],
  },
  {
    id: "starfall",
    name: "Starfall Arena",
    description: "Two minute battle arena. Collect shared stars before rivals do.",
    mode: "stars",
    roadHalfWidth: SCALE * 28,
    hasWalls: true,
    spawn: { x: 28, y: 58 },
    points: [
      { x: 18, y: 58 },
      { x: 218, y: 58 },
    ],
    startLine: { center: { x: 18, y: 58 }, axis: "vertical", halfLength: 0, halfThickness: 0, hitboxHalfThickness: 0 },
    checkpoints: [],
    holes: [
      { center: { x: 74, y: 36 }, radius: 2.2 },
      { center: { x: 148, y: 82 }, radius: 2.4 },
      { center: { x: 190, y: 44 }, radius: 2.0 },
    ],
    hazards: [
      { center: { x: 62, y: 72 }, radius: 3.4, kind: "trap" },
      { center: { x: 118, y: 38 }, radius: 3.2, kind: "boost" },
      { center: { x: 164, y: 64 }, radius: 3.4, kind: "trap" },
      { center: { x: 204, y: 82 }, radius: 3.2, kind: "boost" },
    ],
  },
];
