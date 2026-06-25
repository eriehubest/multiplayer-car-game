import type { GameSettings } from "../config/gameSettings";
import type { InputState } from "../input/InputState";
import { Vector2 } from "../math/Vector2";

export type WorldBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type CarFootprint = {
  center: {
    x: number;
    y: number;
  };
  angle: number;
  halfLength: number;
  halfWidth: number;
  corners: Array<{
    x: number;
    y: number;
  }>;
};

const HITBOX_HEIGHT = 24;
const HITBOX_WIDTH_PER_CHARACTER = 18;
const HITBOX_MIN_LENGTH = 48;

export class PlayerVehicle {
  x = 0;
  y = 0;
  angle = -Math.PI / 2;
  speed = 0;
  velocity = new Vector2();
  inputVector = new Vector2();
  localVector = new Vector2();
  private boostTimer = 0;

  constructor(
    private input: InputState,
    private settings: GameSettings,
  ) {}

  placeAt(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  getFootprint(): CarFootprint {
    const halfLength = Math.max(
      HITBOX_MIN_LENGTH,
      this.settings.playerLabel.length * HITBOX_WIDTH_PER_CHARACTER,
    ) / 2;
    const halfWidth = HITBOX_HEIGHT / 2;
    const forward = this.getForwardVector();
    const right = this.getRightVector();
    const corners = [
      this.corner(forward, right, halfLength, halfWidth),
      this.corner(forward, right, halfLength, -halfWidth),
      this.corner(forward, right, -halfLength, halfWidth),
      this.corner(forward, right, -halfLength, -halfWidth),
    ];

    return {
      center: {
        x: this.x,
        y: this.y,
      },
      angle: this.angle,
      halfLength,
      halfWidth,
      corners,
    };
  }

  getCollisionRadius() {
    const footprint = this.getFootprint();

    return Math.hypot(footprint.halfLength, footprint.halfWidth);
  }

  removeVelocityAlong(normal: Vector2) {
    const inwardSpeed = this.velocity.dot(normal);

    if (inwardSpeed < 0) {
      this.velocity.add(normal.clone().scale(-inwardSpeed));
    }
  }

  update(deltaSeconds: number, bounds?: WorldBounds) {
    this.updateInputVector();
    this.rotateFromInput(deltaSeconds);
    this.applyAcceleration(deltaSeconds);
    this.applyDrift(deltaSeconds);
    this.applySpeedLimit();
    this.boostTimer = Math.max(0, this.boostTimer - deltaSeconds);

    this.x += this.velocity.x * deltaSeconds;
    this.y += this.velocity.y * deltaSeconds;

    if (bounds) {
      this.keepInside(bounds);
    }

    this.speed = this.velocity.length();
  }

  triggerBoost(durationSeconds = 0.55) {
    this.boostTimer = Math.max(this.boostTimer, durationSeconds);
  }

  render(element: HTMLElement | null, cameraX = 0, cameraY = 0) {
    if (!element) return;

    element.style.transform = `
      translate(-50%, -50%)
      rotate(${this.angle}rad)
    `;
    element.style.left = `${this.x - cameraX}px`;
    element.style.top = `${this.y - cameraY}px`;
  }

  private updateInputVector() {
    this.inputVector.set(
      Number(this.input.right) - Number(this.input.left),
      Number(this.input.up) - Number(this.input.down),
    );
  }

  private rotateFromInput(deltaSeconds: number) {
    const forwardSpeed = Math.abs(this.getForwardVector().dot(this.velocity));
    const turnEffect = Math.min(1, Math.max(0.25, forwardSpeed / 120));
    const turnRadians = (this.settings.turnRate * Math.PI / 180) * deltaSeconds;

    this.angle += this.inputVector.x * turnRadians * turnEffect;
  }

  private applyAcceleration(deltaSeconds: number) {
    const forward = this.getForwardVector();

    if (this.inputVector.y > 0) {
      this.velocity.add(forward.scale(this.settings.acceleration * deltaSeconds));
    }

    if (this.inputVector.y < 0) {
      this.velocity.add(forward.scale(-this.settings.brakePower * deltaSeconds));
    }

    if (this.inputVector.y === 0) {
      this.applyFriction(deltaSeconds);
    }
  }

  private applyDrift(deltaSeconds: number) {
    const forward = this.getForwardVector();
    const right = this.getRightVector();
    const lateralSpeed = right.dot(this.velocity);
    const forwardSpeed = forward.dot(this.velocity);
    const turningAmount = Math.abs(this.inputVector.x);
    const lateralRetention = Math.max(0, 1 - this.settings.lateralGrip * deltaSeconds);
    const turnDrag = Math.max(0, 1 - this.settings.turnSpeedLoss * turningAmount * deltaSeconds);

    this.localVector.set(lateralSpeed * lateralRetention, forwardSpeed * turnDrag);
    this.velocity
      .copy(right.scale(this.localVector.x))
      .add(forward.scale(this.localVector.y));
  }

  private applySpeedLimit() {
    const speed = this.velocity.length();
    const reverseLimit = this.settings.maxSpeed * 0.35;
    const forwardSpeed = this.getForwardVector().dot(this.velocity);
    const boostedLimit = this.settings.maxSpeed * 1.55;
    const limit = forwardSpeed < 0
      ? reverseLimit
      : this.boostTimer > 0
        ? boostedLimit
        : this.settings.maxSpeed;

    if (speed > limit) {
      this.velocity.normalize().scale(limit);
    }
  }

  private applyFriction(deltaSeconds: number) {
    const friction = this.settings.friction * deltaSeconds;
    const speed = this.velocity.length();

    if (speed <= friction) {
      this.velocity.set(0, 0);
      return;
    }

    this.velocity.normalize().scale(speed - friction);
  }

  private keepInside(bounds: WorldBounds) {
    const nextX = Math.min(bounds.maxX, Math.max(bounds.minX, this.x));
    const nextY = Math.min(bounds.maxY, Math.max(bounds.minY, this.y));

    if (nextX !== this.x) this.velocity.x = 0;
    if (nextY !== this.y) this.velocity.y = 0;

    this.x = nextX;
    this.y = nextY;
  }

  private getForwardVector() {
    return Vector2.fromAngle(this.angle);
  }

  private getRightVector() {
    return Vector2.fromAngle(this.angle + Math.PI / 2);
  }

  private corner(forward: Vector2, right: Vector2, forwardOffset: number, rightOffset: number) {
    return {
      x: this.x + forward.x * forwardOffset + right.x * rightOffset,
      y: this.y + forward.y * forwardOffset + right.y * rightOffset,
    };
  }
}
