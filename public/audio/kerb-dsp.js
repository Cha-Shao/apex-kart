export class KerbRumble {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.speed = 0;
    this.kerbLeft = 0;
    this.kerbRight = 0;
    this.running = false;
    this.enabled = true;
    this.phase = 0;
    this.thumpPhase = 0;
    this.noiseState = 0x6d2b79f5;
    this.leftGain = 0;
    this.rightGain = 0;
    this.leftTarget = 0;
    this.rightTarget = 0;
  }

  set({ speed = 0, kerbLeft = 0, kerbRight = 0, running = false, enabled = true } = {}) {
    this.speed = Math.max(0, speed);
    this.kerbLeft = Math.max(0, Math.min(1, kerbLeft));
    this.kerbRight = Math.max(0, Math.min(1, kerbRight));
    this.running = !!running;
    this.enabled = !!enabled;
    const active = this.enabled && this.running && this.speed >= 2;
    const speedLevel = Math.min(1, this.speed / 100);
    this.leftTarget = active ? this.kerbLeft * (0.045 + 0.18 * speedLevel) : 0;
    this.rightTarget = active ? this.kerbRight * (0.045 + 0.18 * speedLevel) : 0;
  }

  mix(left, right) {
    const count = Math.min(left.length, right.length);
    const attack = 1 / Math.max(1, this.sampleRate * 0.03);
    const release = 1 / Math.max(1, this.sampleRate * 0.09);
    const active = this.enabled && this.running && this.speed >= 2;
    const stripeHz = Math.max(2, this.speed) / 3.6 / 0.45;
    const phaseStep = stripeHz / this.sampleRate;
    const thumpStep = 2 * Math.PI * 58 / this.sampleRate;

    for (let i = 0; i < count; i++) {
      const leftDiff = this.leftTarget - this.leftGain;
      const rightDiff = this.rightTarget - this.rightGain;
      this.leftGain += leftDiff * (leftDiff > 0 ? attack : release);
      this.rightGain += rightDiff * (rightDiff > 0 ? attack : release);

      let pulse = 0;
      if (active || this.leftGain > 0.0001 || this.rightGain > 0.0001) {
        this.phase += phaseStep;
        if (this.phase >= 1) this.phase -= Math.floor(this.phase);
        if (this.phase < 0.16) {
          const envelope = 1 - this.phase / 0.16;
          pulse = envelope * envelope;
        }
      }

      this.noiseState = (Math.imul(this.noiseState, 1664525) + 1013904223) >>> 0;
      const grit = (this.noiseState / 2147483648 - 1) * pulse;
      this.thumpPhase += thumpStep;
      if (this.thumpPhase >= 2 * Math.PI) this.thumpPhase -= 2 * Math.PI;
      const thump = Math.sin(this.thumpPhase) * pulse;

      const l = left[i] + (this.leftGain + this.rightGain * 0.2) * (thump * 0.72 + grit * 0.28);
      const r = right[i] + (this.rightGain + this.leftGain * 0.2) * (thump * 0.72 + grit * 0.28);
      left[i] = Math.max(-1, Math.min(1, l));
      right[i] = Math.max(-1, Math.min(1, r));
    }
  }
}
