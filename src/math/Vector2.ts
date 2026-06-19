export class Vector2 {
  constructor(
    public x = 0,
    public y = 0,
  ) {}

  set(x: number, y: number) {
    this.x = x;
    this.y = y;
    return this;
  }

  copy(vector: Vector2) {
    this.x = vector.x;
    this.y = vector.y;
    return this;
  }

  add(vector: Vector2) {
    this.x += vector.x;
    this.y += vector.y;
    return this;
  }

  scale(value: number) {
    this.x *= value;
    this.y *= value;
    return this;
  }

  length() {
    return Math.hypot(this.x, this.y);
  }

  dot(vector: Vector2) {
    return this.x * vector.x + this.y * vector.y;
  }

  normalize() {
    const length = this.length();

    if (length > 0) {
      this.scale(1 / length);
    }

    return this;
  }

  clone() {
    return new Vector2(this.x, this.y);
  }

  static fromAngle(angle: number) {
    return new Vector2(Math.cos(angle), Math.sin(angle));
  }
}
