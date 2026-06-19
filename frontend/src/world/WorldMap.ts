import { Vector2 } from "../math/Vector2";

const VOIDTEXT = "void";
const TRACKTEXT = "TRACK";
const WALLTEXT = "WALL";
export const BORDER_THICKNESS = 34;
export const PLAYER_RADIUS = BORDER_THICKNESS / 2;

const SCALE = BORDER_THICKNESS / 2;
const ROAD_HALF_WIDTH = SCALE * 9;
const TRACK_PADDING = SCALE * 12;

type Point = {
  x: number;
  y: number;
};

export type WorldTile = {
  char: string;
  kind: "letter" | "border" | "outside";
};

export type CircleResolution = {
  collided: boolean;
  x: number;
  y: number;
  normal: Vector2;
};

export class WorldMap {
  width = 0;
  height = 0;
  spawn = {
    x: 0,
    y: 0,
  };

  private trackPoints: Point[] = [];

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

    if (distance <= ROAD_HALF_WIDTH) {
      return { char: this.letterForCoordinate(cellX, cellY), kind: "letter" };
    }

    if (distance <= ROAD_HALF_WIDTH + BORDER_THICKNESS) {
      return { char: this.wallCharacterForCoordinate(cellX, cellY), kind: "border" };
    }

    return { char: this.getVoidCharacter(cellX, cellY), kind: "outside" };
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
    return ROAD_HALF_WIDTH;
  }

  getTrackPoints() {
    return this.trackPoints.map((point) => ({ ...point }));
  }

  resolveCircle(x: number, y: number, radius: number): CircleResolution {
    const nearest = this.nearestPointOnTrack(x, y);
    const dx = x - nearest.x;
    const dy = y - nearest.y;
    const distance = Math.hypot(dx, dy);
    const maxDistance = ROAD_HALF_WIDTH - radius;

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
    const rawPoints: Point[] = [
      { x: 8, y: 42 },
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
    ];

    this.trackPoints = rawPoints.map((point) => ({
      x: point.x * SCALE + TRACK_PADDING,
      y: point.y * SCALE + TRACK_PADDING,
    }));

    const xs = this.trackPoints.map((point) => point.x);
    const ys = this.trackPoints.map((point) => point.y);

    this.width = Math.max(...xs) + TRACK_PADDING;
    this.height = Math.max(...ys) + TRACK_PADDING;
    this.spawn = {
      x: this.trackPoints[0].x,
      y: this.trackPoints[0].y,
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

  private getVoidCharacter(x: number, y: number) {
    const position = ((y * 10) % 7 + x) % VOIDTEXT.length;
    return VOIDTEXT[position];
  }
}
