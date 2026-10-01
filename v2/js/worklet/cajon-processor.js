// GERADO por tools/build.mjs a partir de js/core/* e js/worklet/processor-src.js — não editar.
const MOTOR = 'c80119f7f9';

// ---- js/core/constants.js ----
// Constantes compartilhadas entre app, AudioWorklet, testes e ferramentas.

// Golpes do cajón (seção 3.1) + complementos opcionais.
const GOLPES = {
  B: 'Grave',
  S: 'Tapa / slap',
  T: 'Tom / aro',
  g: 'Ghost',
  r: 'Rufo',
  H: 'Chimbal (condução)',
  P: 'Pandeirola',
};
const GOLPES_CAJON = ['B', 'S', 'T', 'g', 'r'];
const COMPLEMENTOS = ['H', 'P'];

// Intensidade 0–127 → ganho linear: ganho = intensidade/100 × REF[golpe].
// Referências escolhidas para que o maior ganho da v1 caiba em 127 sem cortar
// (ver tools/migrar_v1.mjs).
const REF = { B: 1.1, S: 1.1, T: 1.1, r: 1.1, g: 0.32, H: 0.7, P: 0.6 };

const BPM_MIN = 40;
const BPM_MAX = 240;

// Janela de decisão: um tempo é "fechado" (seus golpes agendados) este tanto antes de soar.
// Comando que chega depois disso vale para o tempo/compasso seguinte.
const COMMIT_AHEAD_S = 0.05;

// Limites de segurança do deslocamento de um golpe (microdesvio + humanização).
const DESVIO_MAX_MS = 40;

const clampBpm = (v) => Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(Number(v) * 10) / 10));

// ---- js/core/rng.js ----
// Gerador pseudoaleatório determinístico (mulberry32): mesma semente, mesma humanização.
// Determinismo permite testar a humanização e reproduzir um problema relatado.

function makeRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    // Aproximação de normal padrão (soma de 4 uniformes, desvio ~1), limitada a ±2.5.
    gauss() {
      const s = (next() + next() + next() + next() - 2) * Math.sqrt(3);
      return Math.max(-2.5, Math.min(2.5, s));
    },
    int(n) { return Math.floor(next() * n); },
  };
}

// ---- js/core/fills.js ----
// Viradas, final, contagem e marcação.
//
// ORIGEM: portados da v1 (playOneBeatTransitionFill, bloco 'final', countHat, playHoldMark).
// São adaptações da própria v1, não transcrições de fonte didática: validar de ouvido.
// Na v1, o "T" das viradas tocava a amostra de slap; aqui fica como S para soar igual.
//
// Cada virada ocupa UM pulso (o último antes do tempo 1), dividido em `n` passos.
// Retorna [{ sub, golpe, gain }] onde gain é o ganho da v1 (convertido pelo sequenciador).

const ESTILOS_VIRADA = ['virada', 'repique', 'troca', 'saida', 'entrada', 'compasso', 'reta'];

function viradaUmPulso(estilo, n) {
  const out = [];
  const add = (sub, golpe, gain) => out.push({ sub, golpe, gain });
  const mid = Math.max(1, Math.floor(n / 2)), last = Math.max(1, n - 1);
  for (let rel = 0; rel < n; rel++) {
    switch (estilo) {
      case 'entrada':
        if (rel === 0) add(rel, 'g', 0.2);
        if (n >= 4 && rel === Math.max(1, Math.floor(n * 0.4))) add(rel, 'g', 0.3);
        if (rel === mid) add(rel, 'S', 0.55);
        if (rel === last) { add(rel, 'B', 0.85); add(rel, 'S', 0.7); }
        break;
      case 'saida':
        if (rel === 0) add(rel, 'S', 0.5);
        if (rel === mid) add(rel, 'B', 0.75);
        if (rel === last) { add(rel, 'B', 0.95); add(rel, 'S', 0.85); }
        break;
      case 'troca':
        if (rel === 0) add(rel, 'B', 0.6);
        if (n >= 4 && rel === Math.max(1, Math.floor(n * 0.33))) add(rel, 'g', 0.22);
        if (rel === mid) add(rel, 'B', 0.72);
        if (rel === last) add(rel, 'S', 0.8);
        break;
      case 'compasso':
        if (rel === last) { add(rel, 'B', 0.95); add(rel, 'S', 0.9); }
        else if (rel % 4 === 0) add(rel, 'B', 0.5 + (rel / n) * 0.25);
        else if (rel % 2 === 0) add(rel, 'S', 0.55 + (rel / n) * 0.2);
        break;
      case 'repique':
        if (rel === last) { add(rel, 'B', 0.85); add(rel, 'S', 0.9); }
        else add(rel, 'S', 0.4 + (rel / n) * 0.35);
        break;
      case 'reta':
        if (rel === 0) add(rel, 'B', 0.55);
        if (rel === mid) add(rel, 'B', 0.65);
        if (rel === last) add(rel, 'S', 0.85);
        break;
      default: // 'virada'
        if (rel === 0) add(rel, 'S', 0.54);
        if (rel === mid) add(rel, 'B', 0.68);
        if (rel === last) add(rel, 'S', 0.78);
        if (n >= 6 && rel === last - 1) add(rel, 'g', 0.24);
    }
  }
  return out;
}

// Virada ajustada ao andamento (adaptação deste projeto sobre as viradas da v1; validar de ouvido).
// As figuras da v1 foram pensadas para andamento médio: em 60 BPM "tapa . grave tapa" deixa meio segundo
// de buraco e soa como a batida tropeçando. Aqui, sem sair da grade da batida:
//  - muito lento (passo > 0,3 s): a grade da virada é dividida em 2 (ou 4), ex. semicolcheia → fusa;
//  - buraco maior que BURACO_MAX_S entre dois golpes da virada é preenchido com tapa crescendo
//    (mesma dinâmica do estilo 'repique' da v1), até o acento que volta no tempo 1.
// Em andamento médio/rápido a virada continua igual à da v1.
const BURACO_MAX_S = 0.32;
function viradaNoTempo(estilo, spb, pulsoS) {
  let n = Math.max(1, spb);
  while (pulsoS / n > 0.3 && n < Math.max(1, spb) * 4) n *= 2;
  const ev = viradaUmPulso(estilo, n);
  const passo = pulsoS / n;
  const com = new Set(ev.map((e) => e.sub));
  let ultimo = -1;
  for (let rel = 0; rel < n; rel++) {
    if (com.has(rel)) { ultimo = rel; continue; }
    let prox = rel + 1;
    while (prox < n && !com.has(prox)) prox++;
    if (ultimo >= 0 && (prox - ultimo) * passo > BURACO_MAX_S) {
      ev.push({ sub: rel, golpe: 'S', gain: 0.4 + (rel / n) * 0.35 });
      com.add(rel); ultimo = rel;
    }
  }
  ev.sort((x, y) => x.sub - y.sub);
  return { n, eventos: ev };
}

// Força da virada em relação à batida (adaptação deste projeto; validar de ouvido).
// Os ganhos da v1 (tapa 0,4–0,9; grave 0,5–0,95) foram feitos para o nível da v1. Com as batidas novas
// (tapa 96–112) a virada saía com menos da metade da força e parecia que a batida sumia antes do 1.
// Agora o golpe mais forte da virada chega na força da própria batida e o crescendo da v1 fica comprimido
// entre 72% e 100% dela. Ghost continua ghost.
const GANHO_MAX_VIRADA = { S: 0.9, B: 0.95 };
function forcaVirada(golpe, gain, ref) {
  const gmax = GANHO_MAX_VIRADA[golpe];
  if (!gmax || !ref || !ref[golpe]) return null; // sem referência: o sequenciador usa a conversão padrão
  return ref[golpe] * (0.72 + 0.28 * Math.min(1, gain / gmax));
}

// Acento final (v1: bass 1.2 + slap 1.1 + chimbal .82 + pandeirola .9 acento).
const FINAL = [
  { golpe: 'B', gain: 1.2 },
  { golpe: 'S', gain: 1.1 },
  { golpe: 'H', gain: 0.82 },
  { golpe: 'P', gain: 0.9, variacao: 'acento' },
];

// Contagem (v1 countHat): chimbal em cada pulso, tempo 1 mais forte. Toca mesmo com o chimbal desligado.
const contagem = (pulso) => [{ golpe: 'H', gain: pulso === 0 ? 0.72 : 0.55, forcar: true }];

// Marcação (pedal B na v1): grave em cada pulso; acima de 180 BPM só nos pulsos pares.
function marcacao(pulso, bpm) {
  if (bpm > 180 && pulso % 2 === 1) return [];
  return [{ golpe: 'B', gain: pulso === 0 ? 1 : 0.84 }];
}

// Marcação leve de início (escolhida no app como "começar na marcação"): ghost em cada pulso,
// um pouco mais forte no 1 com grave bem fraco, e um ghost baixinho na subdivisão do compasso da
// música (no "&" em batidas retas; no "a" da tercina em shuffle). Fica assim até o pedal mandar entrar.
// Origem: pedido do Bin (28/09/2026); adaptação, validar de ouvido. Intensidades 0–127.
function marcacaoLeve(pulso, spb) {
  const out = [{ sub: 0, golpe: 'g', vel: pulso === 0 ? 62 : 46 }];
  if (pulso === 0) out.push({ sub: 0, golpe: 'B', vel: 34 });
  if (spb === 3) out.push({ sub: 2, golpe: 'g', vel: 22 });
  else if (spb >= 2) out.push({ sub: spb / 2, golpe: 'g', vel: 20 });
  return out;
}

// ---- js/core/sequencer.js ----
// Sequenciador do cajón — roda dentro do AudioWorklet (thread de áudio) e nos testes em Node.
//
// Relógio: o tempo é contado em quadros de áudio (amostras). Nenhum timer da thread principal
// participa. A posição de cada compasso é calculada a partir de uma âncora
// (quadro inicial + n × duração do compasso), então não há erro acumulado.
//
// Decisões (troca de padrão, BPM, parar, marcação) valem no próximo tempo 1.
// Cada pulso é "fechado" COMMIT_AHEAD_S antes de soar; a virada ocupa o último pulso do
// compasso e só entra se o pedido chegar antes de esse pulso ser fechado.




const toVel = (golpe, gain) => (gain / REF[golpe]) * 100;
// golpe de virada: força relativa à batida que está (ou vai entrar) tocando
const velVirada = (golpe, gain, pat) => forcaVirada(golpe, gain, pat && pat.ref) ?? toVel(golpe, gain);

// Swing como deformação contínua do tempo dentro da unidade de swing.
// sw = 0.5 reto; 0.667 ≈ tercina; unidade = pulso (swing de colcheia) ou meio pulso (semicolcheia).
function swingWarp(f, sw, nivel = 8) {
  if (sw === 0.5) return f;
  const unit = nivel === 16 ? 0.5 : 1;
  const k = Math.floor(f / unit + 1e-9), x = (f - k * unit) / unit;
  const y = x < 0.5 ? x * 2 * sw : sw + (x - 0.5) * 2 * (1 - sw);
  return (k + y) * unit;
}

// A partir deste swing a virada passa para tercina (shuffle). Abaixo dele a virada fica reta.
const SWING_TERCINA = 0.62;

const DEFAULT_PARAMS = {
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

class Sequencer {
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

// ---- js/core/sampler.js ----
// Sampler polifônico com camadas de intensidade + round-robin.
// Roda no AudioWorklet (sem alocação por bloco) e nos testes em Node.


const MAX_VOICES = 48;

class Sampler {
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

// ---- js/worklet/processor-src.js ----
// Processador do AudioWorklet: sequenciador + sampler na thread de áudio.
// FONTE — o arquivo carregado pelo navegador é js/worklet/cajon-processor.js, gerado por
// tools/build.mjs juntando este arquivo com js/core/* (worklets com import estático
// não são usados para não depender de suporte a módulos em worklet no Safari).




class CajonProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = 0;
    this.useGlobalFrame = typeof currentFrame === 'number';
    this.sampler = new Sampler(sampleRate, makeRng(7));
    this.seq = new Sequencer({
      sampleRate,
      seed: 1,
      emit: (off, ev) => this.sampler.trigger(off, ev),
      notify: (msg) => this.port.postMessage(msg),
    });
    this.pendingHits = [];
    this.stab = null; // teste de estabilidade
    this.port.onmessage = (e) => this.onMessage(e.data);
    // MOTOR é escrito pelo build no arquivo empacotado
    this.port.postMessage({ type: 'ready', sampleRate, globalFrame: this.useGlobalFrame, motor: typeof MOTOR === 'string' ? MOTOR : null });
  }

  now() { return this.useGlobalFrame ? currentFrame : this.frame; }

  onMessage(m) {
    switch (m.type) {
      case 'kit': this.sampler.setKit(m.kit); this.port.postMessage({ type: 'kit-ok' }); break;
      case 'volumes': this.sampler.setVolumes(m.volumes); break;
      // golpe imediato (teste de latência): toca no início do próximo bloco e informa o quadro
      case 'hitNow': this.pendingHits.push(m); break;
      case 'stab-start':
        this.seq.trace = [];
        this.stab = { late0: this.seq.stats.late, start: this.now() };
        break;
      case 'stab-report': {
        const tr = this.seq.trace || [];
        this.port.postMessage({ type: 'stab-report', trace: tr.map((t) => t.frame), late: this.seq.stats.late - (this.stab ? this.stab.late0 : 0), stolen: this.sampler.stolen, id: m.id });
        break;
      }
      case 'stab-stop': this.seq.trace = null; this.stab = null; break;
      case 'stats': this.port.postMessage({ type: 'stats', ...this.seq.stats, voices: this.sampler.activeVoices(), stolen: this.sampler.stolen, frame: this.now(), id: m.id }); break;
      default: this.seq.command(m, this.now());
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const n = L.length;
    const start = this.now();
    if (this.pendingHits.length) {
      for (const h of this.pendingHits) {
        this.sampler.trigger(0, { golpe: h.golpe || 'S', vel: h.vel || 110, taxa: 1, durFrames: 0 });
        this.port.postMessage({ type: 'hit', id: h.id, frame: start, sampleRate });
      }
      this.pendingHits.length = 0;
    }
    this.seq.render(start, n);
    this.sampler.process(L, R, n);
    this.frame += n;
    return true;
  }
}

registerProcessor('cajon-processor', CajonProcessor);
