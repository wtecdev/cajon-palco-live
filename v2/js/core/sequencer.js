// Sequenciador do cajón — roda dentro do AudioWorklet (thread de áudio) e nos testes em Node.
//
// Relógio: o tempo é contado em quadros de áudio (amostras). Nenhum timer da thread principal
// participa. A posição de cada compasso é calculada a partir de uma âncora
// (quadro inicial + n × duração do compasso), então não há erro acumulado.
//
// Decisões (troca de padrão, BPM, parar, marcação) valem no próximo tempo 1.
// Cada pulso é "fechado" COMMIT_AHEAD_S antes de soar; a virada ocupa o último pulso do
// compasso e só entra se o pedido chegar antes de esse pulso ser fechado.

import { REF, COMMIT_AHEAD_S, DESVIO_MAX_MS, clampBpm } from './constants.js';
import { viradaNoTempo, forcaVirada, FINAL, contagem, marcacao, marcacaoLeve } from './fills.js';
import { makeRng } from './rng.js';

const toVel = (golpe, gain) => (gain / REF[golpe]) * 100;
// golpe de virada: força relativa à batida que está (ou vai entrar) tocando
const velVirada = (golpe, gain, pat) => forcaVirada(golpe, gain, pat && pat.ref) ?? toVel(golpe, gain);

// Swing como deformação contínua do tempo dentro da unidade de swing.
// sw = 0.5 reto; 0.667 ≈ tercina; unidade = pulso (swing de colcheia) ou meio pulso (semicolcheia).
export function swingWarp(f, sw, nivel = 8) {
  if (sw === 0.5) return f;
  const unit = nivel === 16 ? 0.5 : 1;
  const k = Math.floor(f / unit + 1e-9), x = (f - k * unit) / unit;
  const y = x < 0.5 ? x * 2 * sw : sw + (x - 0.5) * 2 * (1 - sw);
  return (k + y) * unit;
}

// A partir deste swing a virada passa para tercina (shuffle). Abaixo dele a virada fica reta.
export const SWING_TERCINA = 0.62;

export const DEFAULT_PARAMS = {
  swing: null,          // null = usa o swing do padrão; senão 0.5–0.75
  swingNivel: 8,        // 8 = colcheia, 16 = semicolcheia
  humanMs: 3,           // desvio-padrão aproximado ×2 (limite) do tempo aleatório, em ms
  humanVelPct: 6,       // variação aleatória de intensidade, ±%
  contagemCompassos: 1, // compassos de contagem antes de entrar
  inicio: 'contagem',   // 'contagem' ou 'marcacao' (marca leve no compasso da música até o pedal mandar entrar)
  autoViradaCada: 0,    // 0 = desligado; 4 ou 8 compassos
  estiloAutoVirada: 'repique',
  estiloVirada: 'virada',
  trilhas: { H: true, P: false },
};

export class Sequencer {
  constructor({ sampleRate, seed = 1, emit, notify = () => {} }) {
    this.sr = sampleRate;
    this.emit = emit;       // emit(offsetNoBloco, evento)
    this.notify = notify;   // notify(msg)
    this.rng = makeRng(seed);
    this.slots = { A: null, B: null };
    this.active = 'A';
    this.bpm = 120;
    this.params = structuredCloneSafe(DEFAULT_PARAMS);
    this.state = 'stopped'; // 'stopped' | 'count' | 'playing'
    this.hold = false; // false | 'grave' | 'leve'
    this.holdTap = null;
    this.pending = { bpm: null, swap: false, stop: false, fill: null, hold: null, enter: false };
    this.queue = [];
    this.cursor = null;
    this.stats = { late: 0, emitted: 0, beats: 0, bars: 0 };
    this.trace = null; // quando array, registra o quadro de cada tempo 1 (testes)
  }

  effHold() { return this.pending.hold !== null ? this.pending.hold : this.hold; }

  setHold(v) {
    v = v === true ? 'grave' : v || false;
    if (this.state === 'stopped') { this.hold = v; this.notifyState(); return; }
    const p = this.pending;
    p.hold = v === this.hold ? null : v;
    this.notify({ type: 'armed', what: p.hold === null ? 'hold-cancel' : p.hold ? 'hold-' + p.hold : 'hold-off' });
  }

  // ---------- comandos ----------
  command(cmd, frameNow) {
    const p = this.pending;
    switch (cmd.type) {
      case 'setPattern': this.slots[cmd.slot] = cmd.pattern; break;
      case 'params': Object.assign(this.params, cmd.params); if (cmd.params.trilhas) this.params.trilhas = { ...cmd.params.trilhas }; break;
      case 'bpm': {
        const v = clampBpm(cmd.value);
        if (this.state === 'stopped') this.bpm = v; else p.bpm = v;
        break;
      }
      case 'play': if (this.state === 'stopped') this.start(frameNow); break;
      case 'stop': // parada musical: virada no último pulso + acento final no tempo 1
        if (this.state === 'count' || this.state === 'intro') this.stopNow();
        else if (this.state === 'playing') { p.stop = true; this.notify({ type: 'armed', what: 'stop' }); }
        break;
      case 'togglePlay':
        if (this.state === 'stopped') this.start(frameNow);
        else if (this.state === 'intro') this.command({ type: 'enter' }, frameNow);
        else this.command({ type: 'stop' }, frameNow);
        break;
      case 'enter': // sai da marcação leve e entra na batida no próximo tempo 1
        if (this.state === 'intro') { p.enter = true; this.notify({ type: 'armed', what: 'enter' }); }
        break;
      case 'stopNow': this.stopNow(); break;
      case 'swap':
        if (!this.slots.A || !this.slots.B) break;
        if (this.state === 'stopped') { this.active = this.active === 'A' ? 'B' : 'A'; this.notifyState(); }
        else { p.swap = !p.swap; this.notify({ type: 'armed', what: p.swap ? 'swap' : 'swap-cancel' }); }
        break;
      case 'fill':
        if (this.state === 'playing') { p.fill = cmd.style || this.params.estiloVirada; this.notify({ type: 'armed', what: 'fill' }); }
        break;
      case 'hold': // valor direto: false | 'grave' | 'leve' (true = 'grave')
        this.setHold(cmd.value === undefined ? (this.effHold() ? false : 'grave') : cmd.value);
        break;
      case 'holdTap': { // pedal B: 1 toque = só grave / volta; 2 toques seguidos = marcação leve
        const janela = (this.params.duploToqueMs ?? 450) / 1000 * this.sr;
        const duplo = this.holdTap && frameNow - this.holdTap.frame <= janela;
        if (duplo) {
          const antes = this.holdTap.antes;
          this.holdTap = null;
          this.setHold(antes === 'leve' ? 'grave' : 'leve');
        } else {
          const antes = this.effHold();
          this.holdTap = { frame: frameNow, antes };
          this.setHold(antes ? false : 'grave');
        }
        break;
      }
      case 'seed': this.rng = makeRng(cmd.value >>> 0); break;
      default: break;
    }
  }

  notifyState() {
    this.notify({ type: 'state', state: this.state, active: this.active, hold: this.hold, bpm: this.bpm });
  }

  start(frameNow) {
    const pat = this.slots[this.active];
    if (!pat) return;
    const first = frameNow + Math.ceil(COMMIT_AHEAD_S * this.sr);
    this.cursor = {
      kind: this.params.inicio === 'marcacao' ? 'intro' : this.params.contagemCompassos > 0 ? 'count' : 'groove',
      countLeft: this.params.contagemCompassos,
      phraseBar: 0,
      grooveBars: 0,
      pat: null,
      barStart: 0, beat: 0, pulsos: 4, spb: 1, fpb: 1,
      anchorFrame: first, anchorBars: 0, anchorKey: '',
      armedStop: false, armedSwap: false, armedEnter: false,
      startedGroove: false,
    };
    this.pending = { bpm: null, swap: false, stop: false, fill: null, hold: null, enter: false };
    this.state = this.cursor.kind === 'count' ? 'count' : this.cursor.kind === 'intro' ? 'intro' : 'playing';
    this.beginBar(first, true);
    this.notifyState();
  }

  stopNow() {
    this.state = 'stopped';
    this.cursor = null;
    this.queue.length = 0;
    this.pending = { bpm: null, swap: false, stop: false, fill: null, hold: null, enter: false };
    this.notifyState();
  }

  // ---------- linha do tempo ----------
  beginBar(frame, first = false) {
    const c = this.cursor, p = this.pending;
    let resetPhrase = first;
    if (c.armedStop) {
      c.kind = 'final';
    } else if (c.kind === 'intro' && !c.armedEnter) {
      // continua na marcação leve
    } else if (c.kind === 'count' && c.countLeft > 0) {
      // continua contando
    } else {
      if (c.kind === 'count' || c.kind === 'intro') { c.kind = 'groove'; resetPhrase = true; if (this.state !== 'playing') { this.state = 'playing'; this.notifyState(); } }
      if (c.armedSwap) { this.active = this.active === 'A' ? 'B' : 'A'; resetPhrase = true; }
    }
    if (p.hold !== null) { this.hold = p.hold; p.hold = null; }
    if (p.bpm !== null) { this.bpm = p.bpm; p.bpm = null; }
    const pat = this.slots[this.active] || c.pat;
    if (c.pat && pat && c.pat.id !== pat.id) resetPhrase = true;
    if (resetPhrase) c.phraseBar = 0;
    c.pat = pat;
    const pulsos = pat.pulsos;
    const fpb = (60 / this.bpm) * this.sr;
    const key = `${this.bpm}|${pulsos}`;
    // Âncora: enquanto BPM e compasso não mudam, o início de cada compasso é
    // âncora + n × duração, sem somas sucessivas.
    if (key !== c.anchorKey) { c.anchorKey = key; c.anchorFrame = frame; c.anchorBars = 0; }
    c.barStart = c.anchorFrame + c.anchorBars * pulsos * fpb;
    c.beat = 0; c.pulsos = pulsos; c.spb = pat.spb; c.fpb = fpb;
    c.armedStop = false; c.armedSwap = false; c.armedEnter = false;
    if (this.trace) this.trace.push({ frame: c.barStart, kind: c.kind, bpm: this.bpm, pat: pat.id, phraseBar: c.phraseBar, active: this.active, hold: this.hold });
    this.stats.bars++;
    if (!first && c.kind === 'groove') this.notifyState();
  }

  nextBeatFrame() {
    const c = this.cursor;
    return c.barStart + c.beat * c.fpb;
  }

  commitBeat() {
    const c = this.cursor, p = this.pending, prm = this.params;
    const beat = c.beat, bf = this.nextBeatFrame(), last = beat === c.pulsos - 1;
    // o swing da batida vale para o groove e para a marcação leve (início e pedal B), assim a marcação não
    // "endireita". A virada tem regra própria (virGrade/virQuando, abaixo).
    const sw = c.pat && c.spb % 2 === 0 ? (prm.swing ?? c.pat.swing) : 0.5;
    const quando = (fr) => bf + swingWarp(fr, sw, prm.swingNivel) * c.fpb;
    // Virada com swing ligado: o swing NÃO estica as notas da virada (semicolcheias desiguais soavam como
    // "vai parar e entra no tranco"; sem swing o Bin achou perfeito). Swing leve: virada reta, notas iguais.
    // Swing pesado (≥ 62%, shuffle): virada em tercina, também com notas iguais.
    const virGrade = (spb) => (sw >= SWING_TERCINA && spb % 2 === 0 ? 3 : Math.max(1, spb));
    const virQuando = (fr) => bf + fr * c.fpb;
    this.stats.beats++;
    this.notify({
      type: 'beat', frame: bf, beat, pulsos: c.pulsos, kind: c.kind, slot: this.active, pat: c.pat.id,
      phraseBar: c.phraseBar, compassos: c.pat.compassos, bpm: this.bpm, hold: this.hold,
      pend: { swap: p.swap || c.armedSwap, stop: p.stop || c.armedStop, fill: !!p.fill, hold: p.hold, bpm: p.bpm, enter: p.enter || c.armedEnter },
    });

    if (c.kind === 'intro') {
      if (last && p.enter) {
        // pedido de entrar: pulso de "entrada" (ghosts subindo) e batida no próximo 1
        c.armedEnter = true; p.enter = false;
        const v = viradaNoTempo('entrada', Math.max(2, virGrade(c.spb)), c.fpb / this.sr);
        const alvo = this.slots[this.active] || c.pat;
        for (const e of v.eventos) this.pushHuman(virQuando(e.sub / v.n), e.golpe, velVirada(e.golpe, e.gain, alvo), null, 1, 0, 0);
        this.notify({ type: 'fill', frame: bf, style: 'entrada' });
      } else {
        for (const e of marcacaoLeve(beat, c.spb)) this.pushHuman(quando(e.sub / c.spb), e.golpe, e.vel, null, 1, 0, 0);
      }
    } else if (c.kind === 'count') {
      for (const e of contagem(beat)) this.push(bf, e.golpe, toVel(e.golpe, e.gain), null, 1, 0, true);
      if (last) {
        c.countLeft--;
        if (p.stop) { this.stopNow(); return; }
      }
    } else if (c.kind === 'final') {
      for (const e of FINAL) {
        if ((e.golpe === 'H' || e.golpe === 'P') && !prm.trilhas[e.golpe]) continue;
        this.push(bf, e.golpe, toVel(e.golpe, e.gain), e.variacao || null, 1, 0);
      }
      this.state = 'stopped';
      this.cursor = null;
      this.pending = { bpm: null, swap: false, stop: false, fill: null, hold: null, enter: false };
      this.notifyState();
      return;
    } else {
      let fill = null;
      if (last) {
        if (p.stop) { c.armedStop = true; p.stop = false; fill = prm.estiloVirada; }
        else if (p.swap) { c.armedSwap = true; p.swap = false; fill = prm.estiloVirada; }
        else if (p.fill) { fill = p.fill; p.fill = null; }
        else if (prm.autoViradaCada > 0 && !this.hold && (c.grooveBars + 1) % prm.autoViradaCada === 0) fill = prm.estiloAutoVirada;
      }
      if (fill) {
        const v = viradaNoTempo(fill, virGrade(c.spb), c.fpb / this.sr);
        for (const e of v.eventos) this.pushHuman(virQuando(e.sub / v.n), e.golpe, velVirada(e.golpe, e.gain, c.pat), null, 1, 0, 0);
        this.notify({ type: 'fill', frame: bf, style: fill });
      } else if (this.hold === 'leve') {
        for (const e of marcacaoLeve(beat, c.spb)) this.pushHuman(quando(e.sub / c.spb), e.golpe, e.vel, null, 1, 0, 0);
      } else if (this.hold) {
        for (const e of marcacao(beat, this.bpm)) this.push(bf, e.golpe, toVel(e.golpe, e.gain), null, 1, 0);
      } else {
        const events = c.pat.grid[c.phraseBar % c.pat.compassos][beat] || [];
        for (const e of events) {
          if ((e.golpe === 'H' || e.golpe === 'P') && !prm.trilhas[e.golpe]) continue;
          this.pushHuman(quando(e.sub / c.spb), e.golpe, e.vel, e.variacao, e.taxa, e.durMs, e.devMs);
        }
      }
    }

    if (last) {
      const endFrame = c.barStart + c.pulsos * c.fpb;
      if (c.kind === 'groove') { c.grooveBars++; c.phraseBar = (c.phraseBar + 1) % c.pat.compassos; }
      c.anchorBars++;
      this.beginBar(endFrame);
    } else {
      c.beat++;
    }
  }

  pushHuman(frame, golpe, vel, variacao, taxa, durMs, devMs) {
    const prm = this.params;
    let dev = devMs;
    if (prm.humanMs > 0) dev += Math.max(-prm.humanMs, Math.min(prm.humanMs, this.rng.gauss() * prm.humanMs / 2));
    dev = Math.max(-DESVIO_MAX_MS, Math.min(DESVIO_MAX_MS, dev));
    let v = vel;
    if (prm.humanVelPct > 0) v *= 1 + (this.rng.next() * 2 - 1) * (prm.humanVelPct / 100);
    this.push(frame + (dev * this.sr) / 1000, golpe, v, variacao, taxa, durMs);
  }

  push(frame, golpe, vel, variacao, taxa, durMs, forcar = false) {
    const ev = { frame, golpe, vel: Math.max(1, Math.min(127, vel)), variacao, taxa: taxa || 1, durFrames: durMs ? (durMs * this.sr) / 1000 : 0, forcar };
    // inserção ordenada (fila curta: no máximo alguns pulsos)
    const q = this.queue;
    let i = q.length;
    while (i > 0 && q[i - 1].frame > frame) i--;
    q.splice(i, 0, ev);
  }

  // Chamado a cada bloco de áudio. `start` = quadro absoluto do início do bloco.
  render(start, n) {
    const end = start + n;
    if (this.cursor) {
      const ahead = COMMIT_AHEAD_S * this.sr;
      while (this.cursor && this.nextBeatFrame() < end + ahead) this.commitBeat();
    }
    const q = this.queue;
    let k = 0;
    while (k < q.length && q[k].frame < end) {
      const ev = q[k++];
      let off = Math.floor(ev.frame - start);
      if (off < 0) { this.stats.late++; off = 0; }
      this.stats.emitted++;
      this.emit(off, ev);
    }
    if (k) q.splice(0, k);
  }
}

function structuredCloneSafe(o) { return JSON.parse(JSON.stringify(o)); }
