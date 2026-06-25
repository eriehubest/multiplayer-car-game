import type { GameSettings } from "../config/gameSettings";
import type { PlayerVehicle } from "../entities/PlayerVehicle";

type DebugPanelCallbacks = {
  onLetterColorChange: () => void;
  onTrackFontChange: () => void;
  onPlayerColorChange: () => void;
};

export class DebugPanel {
  constructor(private settings: GameSettings) {}

  render() {
    return `
      <aside class="debug-panel" aria-label="Debug controls">
        <h1>debug</h1>

        <label>
          <span>letter color</span>
          <input id="letter-color" type="color" value="${this.settings.letterColor}" />
        </label>

        <label>
          <span>track font</span>
          <select id="track-font">
            ${this.renderFontOption("\"Courier New\", Courier, ui-monospace, monospace", "Courier")}
            ${this.renderFontOption("Menlo, Monaco, Consolas, monospace", "Menlo")}
            ${this.renderFontOption("Georgia, \"Times New Roman\", serif", "Georgia")}
            ${this.renderFontOption("Impact, \"Arial Narrow\", sans-serif", "Impact")}
            ${this.renderFontOption("\"Trebuchet MS\", Arial, sans-serif", "Trebuchet")}
          </select>
        </label>

        <label>
          <span>player color</span>
          <input id="player-color" type="color" value="${this.settings.playerColor}" />
        </label>

        <label>
          <span>max speed <strong>${this.settings.maxSpeed}px/s</strong></span>
          <input id="max-speed" type="range" min="80" max="1200" value="${this.settings.maxSpeed}" />
        </label>

        <label>
          <span>acceleration <strong>${this.settings.acceleration}px/s²</strong></span>
          <input id="acceleration" type="range" min="100" max="1200" value="${this.settings.acceleration}" />
        </label>

        <label>
          <span>turn rate <strong>${this.settings.turnRate}°/s</strong></span>
          <input id="turn-rate" type="range" min="60" max="520" value="${this.settings.turnRate}" />
        </label>

        <label>
          <span>lateral grip <strong>${this.settings.lateralGrip}</strong></span>
          <input id="lateral-grip" type="range" min="1" max="10" step="0.1" value="${this.settings.lateralGrip}" />
        </label>

        <label>
          <span>turn drag <strong>${this.settings.turnSpeedLoss}</strong></span>
          <input id="turn-speed-loss" type="range" min="0" max="3" step="0.1" value="${this.settings.turnSpeedLoss}" />
        </label>

        <dl class="debug-readout">
          <div><dt>x</dt><dd id="readout-x">0</dd></div>
          <div><dt>y</dt><dd id="readout-y">0</dd></div>
          <div><dt>speed</dt><dd id="readout-speed">0</dd></div>
          <div><dt>angle</dt><dd id="readout-angle">0</dd></div>
          <div><dt>input</dt><dd id="readout-input">0, 0</dd></div>
          <div><dt>local</dt><dd id="readout-local">0, 0</dd></div>
          <div><dt>velocity</dt><dd id="readout-velocity">0, 0</dd></div>
        </dl>
      </aside>
    `;
  }

  bind(callbacks: DebugPanelCallbacks) {
    const letterColor = document.querySelector<HTMLInputElement>("#letter-color");
    const trackFont = document.querySelector<HTMLSelectElement>("#track-font");
    const playerColor = document.querySelector<HTMLInputElement>("#player-color");
    const maxSpeed = document.querySelector<HTMLInputElement>("#max-speed");
    const acceleration = document.querySelector<HTMLInputElement>("#acceleration");
    const turnRate = document.querySelector<HTMLInputElement>("#turn-rate");
    const lateralGrip = document.querySelector<HTMLInputElement>("#lateral-grip");
    const turnSpeedLoss = document.querySelector<HTMLInputElement>("#turn-speed-loss");

    letterColor?.addEventListener("input", () => {
      this.settings.letterColor = letterColor.value;
      callbacks.onLetterColorChange();
    });

    trackFont?.addEventListener("change", () => {
      this.settings.trackFontFamily = trackFont.value;
      callbacks.onTrackFontChange();
    });

    playerColor?.addEventListener("input", () => {
      this.settings.playerColor = playerColor.value;
      callbacks.onPlayerColorChange();
    });

    maxSpeed?.addEventListener("input", () => {
      this.settings.maxSpeed = Number(maxSpeed.value);
      this.updateControlLabel(maxSpeed, `${this.settings.maxSpeed}px/s`);
    });

    acceleration?.addEventListener("input", () => {
      this.settings.acceleration = Number(acceleration.value);
      this.updateControlLabel(acceleration, `${this.settings.acceleration}px/s²`);
    });

    turnRate?.addEventListener("input", () => {
      this.settings.turnRate = Number(turnRate.value);
      this.updateControlLabel(turnRate, `${this.settings.turnRate}°/s`);
    });

    lateralGrip?.addEventListener("input", () => {
      this.settings.lateralGrip = Number(lateralGrip.value);
      this.updateControlLabel(lateralGrip, String(this.settings.lateralGrip));
    });

    turnSpeedLoss?.addEventListener("input", () => {
      this.settings.turnSpeedLoss = Number(turnSpeedLoss.value);
      this.updateControlLabel(turnSpeedLoss, String(this.settings.turnSpeedLoss));
    });
  }

  updateReadout(player: PlayerVehicle) {
    const x = document.querySelector<HTMLElement>("#readout-x");
    const y = document.querySelector<HTMLElement>("#readout-y");
    const speed = document.querySelector<HTMLElement>("#readout-speed");
    const angle = document.querySelector<HTMLElement>("#readout-angle");
    const input = document.querySelector<HTMLElement>("#readout-input");
    const local = document.querySelector<HTMLElement>("#readout-local");
    const velocity = document.querySelector<HTMLElement>("#readout-velocity");

    if (x) x.textContent = `${Math.round(player.x)}px`;
    if (y) y.textContent = `${Math.round(player.y)}px`;
    if (speed) speed.textContent = `${Math.round(player.speed)}px/s`;
    if (angle) {
      const degrees = ((player.angle * 180 / Math.PI) + 360) % 360;
      angle.textContent = `${Math.round(degrees)}°`;
    }
    if (input) {
      input.textContent = this.formatVector(player.inputVector.x, player.inputVector.y);
    }
    if (local) {
      local.textContent = this.formatVector(player.localVector.x, player.localVector.y);
    }
    if (velocity) {
      velocity.textContent = this.formatVector(player.velocity.x, player.velocity.y);
    }
  }

  private updateControlLabel(input: HTMLInputElement, value: string) {
    input.previousElementSibling?.querySelector("strong")?.replaceChildren(value);
  }

  private renderFontOption(value: string, label: string) {
    const selected = value === this.settings.trackFontFamily ? " selected" : "";

    return `<option value="${value}"${selected}>${label}</option>`;
  }

  private formatVector(x: number, y: number) {
    return `${Math.round(x)}, ${Math.round(y)}`;
  }
}
