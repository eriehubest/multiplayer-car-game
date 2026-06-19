import type { PlayerVehicle } from "../entities/PlayerVehicle";
import type { WorldBounds } from "../entities/PlayerVehicle";

export class Camera {
  x = 0;
  y = 0;
  targetX = 0;
  targetY = 0;
  smoothing = 7.5;
  followMargin = 0.4;

  follow(player: PlayerVehicle, bounds: DOMRect, worldBounds?: WorldBounds) {
    const marginX = bounds.width * this.followMargin;
    const marginY = bounds.height * this.followMargin;
    const screenX = player.x - this.targetX;
    const screenY = player.y - this.targetY;

    if (screenX < marginX) {
      this.targetX = player.x - marginX;
    }

    if (screenX > bounds.width - marginX) {
      this.targetX = player.x - (bounds.width - marginX);
    }

    if (screenY < marginY) {
      this.targetY = player.y - marginY;
    }

    if (screenY > bounds.height - marginY) {
      this.targetY = player.y - (bounds.height - marginY);
    }

    if (worldBounds) {
      this.clampTargetToWorld(bounds, worldBounds);
    }
  }

  update(deltaSeconds: number) {
    const blend = 1 - Math.exp(-this.smoothing * deltaSeconds);

    this.x += (this.targetX - this.x) * blend;
    this.y += (this.targetY - this.y) * blend;
  }

  snapToTarget() {
    this.x = this.targetX;
    this.y = this.targetY;
  }

  private clampTargetToWorld(viewport: DOMRect, worldBounds: WorldBounds) {
    this.targetX = Math.min(
      Math.max(worldBounds.maxX - viewport.width, worldBounds.minX),
      Math.max(worldBounds.minX, this.targetX),
    );
    this.targetY = Math.min(
      Math.max(worldBounds.maxY - viewport.height, worldBounds.minY),
      Math.max(worldBounds.minY, this.targetY),
    );
  }
}
