export class TyreSqueal {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.speed = 0;
    this.squealLeft = 0;
    this.squealRight = 0;
    this.running = false;
    this.enabled = false;
    this.leftTarget = 0;
    this.rightTarget = 0;
    this.leftGain = 0;
    this.rightGain = 0;
    this.leftPhase = 0;
    this.rightPhase = 0;
    this.leftOvertonePhase = 0;
    this.rightOvertonePhase = 0;
    this.leftHarmonicPhase = 0;
    this.rightHarmonicPhase = 0;
    this.noiseState = 0x3c6ef372;
    this.noiseLow = 0;
    this.noisePrev = 0;
  }

  set({ speed = 0, squealLeft = 0, squealRight = 0, running = false, enabled = false } = {}) {
    this.speed = Math.max(0, speed);
    this.squealLeft = Math.max(0, Math.min(1, squealLeft));
    this.squealRight = Math.max(0, Math.min(1, squealRight));
    this.running = !!running;
    this.enabled = !!enabled;
    const active = this.enabled && this.running && this.speed > 12;
    const speedLevel = Math.min(1, (this.speed - 12) / 70);
    const scale = active ? (0.022 + speedLevel * 0.065) : 0;
    this.leftTarget = this.squealLeft * scale;
    this.rightTarget = this.squealRight * scale;
  }

  mix(left, right) {
    const count = Math.min(left.length, right.length);
    const attack = 1 / Math.max(1, this.sampleRate * 0.025);
    const release = 1 / Math.max(1, this.sampleRate * 0.1);
    const active = this.enabled && this.running && this.speed > 12;
    const speedLevel = Math.min(1, Math.max(0, (this.speed - 12) / 70));
    const baseHz = 650 + speedLevel * 560;
    const vibratoHz = 3.2 + speedLevel * 1.8;
    const phaseStep = 2 * Math.PI * baseHz / this.sampleRate;
    const harmonicStep = 2 * Math.PI * (baseHz * 1.47) / this.sampleRate;
    const vibratoStep = 2 * Math.PI * vibratoHz / this.sampleRate;
    const noiseBlend = 0.18;

    for (let i = 0; i < count; i++) {
      const leftDiff = this.leftTarget - this.leftGain;
      const rightDiff = this.rightTarget - this.rightGain;
      this.leftGain += leftDiff * (leftDiff > 0 ? attack : release);
      this.rightGain += rightDiff * (rightDiff > 0 ? attack : release);

      this.noiseState = (Math.imul(this.noiseState, 1664525) + 1013904223) >>> 0;
      const white = this.noiseState / 2147483648 - 1;
      this.noiseLow += (white - this.noiseLow) * 0.14;
      const friction = white - this.noiseLow - this.noisePrev * 0.12;
      this.noisePrev = white;

      let leftTone = 0;
      let rightTone = 0;
      if (active || this.leftGain > 0.0001 || this.rightGain > 0.0001) {
        const tremolo = 1 + 0.07 * Math.sin(this.leftHarmonicPhase);
        leftTone = tremolo * (0.68 * Math.sin(this.leftPhase) + 0.32 * Math.sin(this.leftOvertonePhase));
        const rightTremolo = 1 + 0.07 * Math.sin(this.rightHarmonicPhase);
        rightTone = rightTremolo * (0.68 * Math.sin(this.rightPhase) + 0.32 * Math.sin(this.rightOvertonePhase));
        this.leftPhase += phaseStep * (1 + 0.025 * Math.sin(this.leftHarmonicPhase));
        this.rightPhase += phaseStep * (1 + 0.025 * Math.sin(this.rightHarmonicPhase));
        this.leftOvertonePhase = (this.leftOvertonePhase + harmonicStep) % (2 * Math.PI);
        this.rightOvertonePhase = (this.rightOvertonePhase + harmonicStep * 1.006) % (2 * Math.PI);
        this.leftHarmonicPhase += vibratoStep;
        this.rightHarmonicPhase += vibratoStep * 1.013;
        if (this.leftPhase >= 2 * Math.PI) this.leftPhase -= 2 * Math.PI;
        if (this.rightPhase >= 2 * Math.PI) this.rightPhase -= 2 * Math.PI;
        if (this.leftHarmonicPhase >= 2 * Math.PI) this.leftHarmonicPhase -= 2 * Math.PI;
        if (this.rightHarmonicPhase >= 2 * Math.PI) this.rightHarmonicPhase -= 2 * Math.PI;
      }

      const leftSqueal = leftTone * (1 - noiseBlend) + friction * noiseBlend;
      const rightSqueal = rightTone * (1 - noiseBlend) + friction * noiseBlend;
      const l = left[i] + this.leftGain * leftSqueal + this.rightGain * rightSqueal * 0.2;
      const r = right[i] + this.rightGain * rightSqueal + this.leftGain * leftSqueal * 0.2;
      left[i] = Math.max(-1, Math.min(1, l));
      right[i] = Math.max(-1, Math.min(1, r));
    }
  }
}
