import type { PlayerVehicle } from "../entities/PlayerVehicle";
import type { WorldMap } from "../world/WorldMap";

export class Minimap {
  private context: CanvasRenderingContext2D | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.context = canvas.getContext("2d");
  }

  render(world: WorldMap, player: PlayerVehicle) {
    if (!this.context) return;

    const pixelRatio = window.devicePixelRatio || 1;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;

    if (
      this.canvas.width !== Math.round(width * pixelRatio) ||
      this.canvas.height !== Math.round(height * pixelRatio)
    ) {
      this.canvas.width = Math.round(width * pixelRatio);
      this.canvas.height = Math.round(height * pixelRatio);
    }

    const ctx = this.context;
    const padding = 14;
    const scale = Math.min(
      (width - padding * 2) / world.width,
      (height - padding * 2) / world.height,
    );
    const offsetX = (width - world.width * scale) / 2;
    const offsetY = (height - world.height * scale) / 2;

    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgb(12 15 19 / 0.82)";
    ctx.fillRect(0, 0, width, height);

    this.drawTrack(ctx, world, offsetX, offsetY, scale);
    this.drawPlayer(ctx, player, offsetX, offsetY, scale);
  }

  private drawTrack(
    ctx: CanvasRenderingContext2D,
    world: WorldMap,
    offsetX: number,
    offsetY: number,
    scale: number,
  ) {
    const points = world.getTrackPoints();

    if (points.length === 0) return;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#ff4d5e";
    ctx.lineWidth = (world.getRoadHalfWidth() * 2 + 34) * scale;
    ctx.beginPath();
    ctx.moveTo(offsetX + points[0].x * scale, offsetY + points[0].y * scale);

    for (const point of points.slice(1)) {
      ctx.lineTo(offsetX + point.x * scale, offsetY + point.y * scale);
    }

    ctx.stroke();

    ctx.strokeStyle = "#20262f";
    ctx.lineWidth = world.getRoadHalfWidth() * 2 * scale;
    ctx.stroke();
  }

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    player: PlayerVehicle,
    offsetX: number,
    offsetY: number,
    scale: number,
  ) {
    const x = offsetX + player.x * scale;
    const y = offsetY + player.y * scale;

    ctx.fillStyle = "#ffcf33";
    ctx.shadowColor = "#ffcf33";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}
