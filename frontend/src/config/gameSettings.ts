export type GameSettings = {
  letterColor: string;
  playerColor: string;
  maxSpeed: number;
  acceleration: number;
  brakePower: number;
  friction: number;
  turnRate: number;
  lateralGrip: number;
  turnSpeedLoss: number;
};

export const DEBUG_PANEL_WIDTH = 280;
export const GAME_INSET = 50;

export function createDefaultSettings(): GameSettings {
  return {
    letterColor: "#56606d",
    playerColor: "#ffcf33",
    maxSpeed: 676,
    acceleration: 520,
    brakePower: 720,
    friction: 140,
    turnRate: 220,
    lateralGrip: 3.8,
    turnSpeedLoss: 0.9,
  };
}
