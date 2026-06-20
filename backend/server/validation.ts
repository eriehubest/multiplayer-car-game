export function normalizeRoomId(value: string | null) {
  const roomId = value?.trim() || "default";

  return roomId.slice(0, 64).replaceAll(/[^\w-]/g, "-");
}

export function normalizePlayerName(value: string | null) {
  const name = value?.trim() || "player";

  return name.slice(0, 24);
}

export function normalizeColor(value: string | undefined | null) {
  if (!value) return null;

  return /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}

export function clampFinite(value: number) {
  if (!Number.isFinite(value)) return 0;

  return Math.max(-1_000_000, Math.min(1_000_000, value));
}
