const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

export class InputState {
  up = false;
  down = false;
  left = false;
  right = false;

  setKey(key: string, isPressed: boolean) {
    if (key === "ArrowUp") this.up = isPressed;
    if (key === "ArrowDown") this.down = isPressed;
    if (key === "ArrowLeft") this.left = isPressed;
    if (key === "ArrowRight") this.right = isPressed;
  }

  handles(key: string) {
    return ARROW_KEYS.includes(key);
  }
}
