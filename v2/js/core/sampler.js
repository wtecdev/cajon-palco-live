// Sampler polifônico com camadas de intensidade + round-robin.
// Roda no AudioWorklet (sem alocação por bloco) e nos testes em Node.

import { REF, GOLPES } from './constants.js';

const MAX_VOICES = 48;

export class Sampler {
  constructor(sampleRate, rng) {
    this.sr = sampleRate;
    this.rng = rng;
    this.banks = {};      // chave "B" ou "P.acento" → { trim, layers:[{ate, samples:[{L,R,len,gain}], last:-1}] }
    this.volume = {};     // volume de mixagem por golpe (0–1.5)
    for (const g of Object.keys(GOLPES)) this.volume[g] = 1;
    this.voices = Array.from({ length: MAX_VOICES }, () => ({ on: false, L: null, R: null, len: 0, pos: 0, rate: 1, gain: 0, delay: 0, stopAt: Infinity, fade: 0, age: 0 }));
    this.age = 0;
    this.stolen = 0;
  }

  // kit: { golpes: { B: { trim, camadas:[{ate, amostras:[{L,R,len,ganho}]}], variacoes:{nome:{camadas}}, usa:'S' } } }
  // (as amostras já decodificadas em Float32Array pelo app)
  setKit(kit) {
    const banks = {};
    const mk = (trim, camadas) => ({ trim, layers: camadas.map((c) => ({ ate: c.ate, samples: c.amostras, last: -1 })).sort((a, b) => a.ate - b.ate) });
    for (const [g, def] of Object.entries(kit.golpes)) {
      if (def.camadas) banks[g] = mk(def.trim ?? 1, def.camadas);
      if (def.variacoes) for (const [v, vd] of Object.entries(def.variacoes)) banks[`${g}.${v}`] = mk(vd.trim ?? def.trim ?? 1, vd.camadas);
    }
    for (const [g, def] of Object.entries(kit.golpes)) {
      if (def.usa && banks[def.usa]) banks[g] = { trim: def.trim ?? banks[def.usa].trim, layers: banks[def.usa].layers.map((l) => ({ ...l, last: -1 })) };
    }
    this.banks = banks;
  }

  setVolumes(vol) { Object.assign(this.volume, vol); }

  pick(bank, vel) {
    let layer = bank.layers[bank.layers.length - 1];
    for (const l of bank.layers) if (vel <= l.ate) { layer = l; break; }
    const n = layer.samples.length;
    if (!n) return null;
    let i = 0;
    if (n > 1) {
      // round-robin aleatório sem repetir a última amostra
      i = this.rng.int(n - 1);
      if (i >= layer.last) i++;
    }
    layer.last = i;
    return layer.samples[i];
  }

  // offset: quadros dentro do bloco atual em que o golpe começa
  trigger(offset, ev) {
    const bank = (ev.variacao && this.banks[`${ev.golpe}.${ev.variacao}`]) || this.banks[ev.golpe];
    if (!bank) return false;
    const s = this.pick(bank, ev.vel);
    if (!s) return false;
    const gain = (ev.vel / 100) * REF[ev.golpe] * bank.trim * (s.ganho ?? 1) * (this.volume[ev.golpe] ?? 1);
    if (gain <= 0) return false;
    let v = this.voices.find((x) => !x.on);
    if (!v) { v = this.voices.reduce((a, b) => (a.age < b.age ? a : b)); this.stolen++; }
    v.on = true; v.L = s.L; v.R = s.R || s.L; v.len = s.len; v.pos = 0; v.rate = ev.taxa || 1;
    v.gain = gain; v.delay = offset; v.age = ++this.age;
    if (ev.durFrames > 0) {
      v.fade = Math.max(1, Math.min(0.014 * this.sr, ev.durFrames * 0.24));
      v.stopAt = ev.durFrames;
    } else { v.fade = 0; v.stopAt = Infinity; }
    return true;
  }

  // Soma todas as vozes em outL/outR (já zerados pelo host) por n quadros.
  process(outL, outR, n) {
    for (const v of this.voices) {
      if (!v.on) continue;
      let i = 0;
      if (v.delay > 0) { i = Math.min(n, v.delay); v.delay -= i; if (i >= n) continue; }
      const L = v.L, R = v.R, len = v.len, rate = v.rate;
      let pos = v.pos;
      for (; i < n; i++) {
        if (pos >= len - 1 || pos >= v.stopAt) { v.on = false; break; }
        let g = v.gain;
        if (v.fade && pos > v.stopAt - v.fade) g *= Math.max(0, (v.stopAt - pos) / v.fade);
        let l, r;
        if (rate === 1) { l = L[pos]; r = R[pos]; }
        else {
          const i0 = pos | 0, fr = pos - i0;
          l = L[i0] + (L[i0 + 1] - L[i0]) * fr;
          r = R[i0] + (R[i0 + 1] - R[i0]) * fr;
        }
        outL[i] += l * g;
        outR[i] += r * g;
        pos += rate;
      }
      v.pos = pos;
    }
  }

  activeVoices() { return this.voices.reduce((a, v) => a + (v.on ? 1 : 0), 0); }
}
