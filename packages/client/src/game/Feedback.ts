export class Feedback {
  #context: AudioContext | null = null;

  activate(): void {
    if (!this.#context) {
      this.#context = new AudioContext();
    }
    if (this.#context.state === "suspended") {
      void this.#context.resume();
    }
  }

  swallow(): void {
    const context = this.#context;
    if (!context) {
      return;
    }
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(230, now);
    oscillator.frequency.exponentialRampToValueAtTime(84, now + 0.16);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.125, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.19);
    navigator.vibrate?.([14, 12, 24]);
  }

  dispose(): void {
    if (this.#context) {
      void this.#context.close();
      this.#context = null;
    }
  }
}
