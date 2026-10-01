// Motor de áudio (thread principal): cria o AudioContext, o AudioWorklet e a cadeia de mixagem.
// O tempo musical NÃO passa por aqui — só comandos e mensagens de estado.

import { MOTOR } from './versao.js';

// Baixa um arquivo tentando de novo quando o servidor falha por um instante (HTTP 5xx/429 ou rede).
// Aconteceu na página de teste: "amostra kit3_ghost_3.wav: HTTP 503" ao baixar as amostras todas juntas.
async function buscar(url, nome, tentativas = 4) {
  let ultimo = '';
  for (let k = 0; k < tentativas; k++) {
    if (k) await new Promise((r) => setTimeout(r, 300 * 2 ** (k - 1))); // 0,3 s · 0,6 s · 1,2 s
    try {
      const r = await fetch(url);
      if (r.ok) return r;
      ultimo = `HTTP ${r.status}`;
      if (r.status < 500 && r.status !== 429) break; // erro definitivo (ex.: 404): não adianta repetir
    } catch (e) { ultimo = e.message; }
  }
  throw new Error(`${nome}: ${ultimo}`);
}

export class Engine extends EventTarget {
  constructor() {
    super();
    this.ctx = null;
    this.node = null;
    this.ready = false;
    this.kitInfo = null;
    this.nodes = {};
    this.info = { audioSession: 'indisponível', globalFrame: null };
    this._hitWaiters = new Map();
    this._reqId = 1;
  }

  // Precisa ser chamado dentro de um gesto do usuário (toque/tecla), exigência do iOS.
  async init() {
    if (this.ctx) return;
    // iOS: sem isto o Web Audio fica mudo com a chave de silêncio ligada.
    if ('audioSession' in navigator) {
      try { navigator.audioSession.type = 'playback'; this.info.audioSession = navigator.audioSession.type; } catch (e) { this.info.audioSession = 'erro: ' + e.message; }
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    if (!this.ctx.audioWorklet) throw new Error('Este navegador não tem AudioWorklet (iOS precisa 14.5 ou mais novo).');
    // ?m= muda a cada versão do motor: o navegador não reaproveita um motor antigo do cache
    const urlMotor = new URL('./worklet/cajon-processor.js', import.meta.url);
    urlMotor.searchParams.set('m', MOTOR);
    await this.ctx.audioWorklet.addModule(urlMotor);
    this.node = new AudioWorkletNode(this.ctx, 'cajon-processor', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    this.node.port.onmessage = (e) => this._onMessage(e.data);
    this.node.onprocessorerror = () => this.dispatchEvent(new CustomEvent('erro', { detail: 'O processador de áudio parou com erro.' }));
    this._buildChain();
    this.ctx.onstatechange = () => this.dispatchEvent(new CustomEvent('ctxstate', { detail: this.ctx.state }));
    await this.ctx.resume();
    this.ready = true;
  }

  _buildChain() {
    const c = this.ctx, n = this.nodes;
    n.eqLow = c.createBiquadFilter(); n.eqLow.type = 'lowshelf'; n.eqLow.frequency.value = 140;
    n.eqMid = c.createBiquadFilter(); n.eqMid.type = 'peaking'; n.eqMid.frequency.value = 950; n.eqMid.Q.value = 0.8;
    n.eqHigh = c.createBiquadFilter(); n.eqHigh.type = 'highshelf'; n.eqHigh.frequency.value = 3500;
    // "Compressor" com os valores da v1 (era chamado de limiter lá)
    n.comp = c.createDynamicsCompressor();
    // Limitador de saída: DynamicsCompressorNode com razão alta. Não é um brickwall perfeito.
    n.lim = c.createDynamicsCompressor();
    n.lim.threshold.value = -3; n.lim.knee.value = 0; n.lim.ratio.value = 20; n.lim.attack.value = 0.001; n.lim.release.value = 0.1;
    n.master = c.createGain();
    this.node.connect(n.eqLow);
    n.eqLow.connect(n.eqMid).connect(n.eqHigh);
    this._route({ comp: true, lim: true });
  }

  // Liga/desliga compressor e limitador refazendo as conexões (bypass real).
  _route({ comp, lim }) {
    const n = this.nodes;
    [n.eqHigh, n.comp, n.lim, n.master].forEach((x) => { try { x.disconnect(); } catch (_) {} });
    let last = n.eqHigh;
    if (comp) { last.connect(n.comp); last = n.comp; }
    if (lim) { last.connect(n.lim); last = n.lim; }
    last.connect(n.master);
    n.master.connect(this.ctx.destination);
  }

  applyMix(mix) {
    if (!this.ctx) return;
    const n = this.nodes, t = this.ctx.currentTime;
    n.eqLow.gain.setTargetAtTime(mix.eq.grave, t, 0.02);
    n.eqMid.gain.setTargetAtTime(mix.eq.medio, t, 0.02);
    n.eqHigh.gain.setTargetAtTime(mix.eq.agudo, t, 0.02);
    const k = mix.comp;
    n.comp.threshold.value = k.limiar; n.comp.knee.value = k.joelho; n.comp.ratio.value = k.razao;
    n.comp.attack.value = k.ataque; n.comp.release.value = k.soltura;
    n.master.gain.setTargetAtTime(mix.master, t, 0.02);
    this._route({ comp: mix.compLigado, lim: mix.limLigado });
    const vol = {};
    for (const [g, v] of Object.entries(mix.volumes)) vol[g] = v / 100;
    this.send({ type: 'volumes', volumes: vol });
  }

  send(msg) { if (this.node) this.node.port.postMessage(msg); }

  async resume() { if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume(); }

  // ---------- kit ----------
  async loadKit(baseUrl) {
    const base = new URL(baseUrl, document.baseURI);
    const def = await (await buscar(new URL('kit.json', base), 'kit.json')).json();
    const cache = new Map();
    const decode = (buf) => new Promise((ok, fail) => this.ctx.decodeAudioData(buf, ok, fail)); // forma com callback: funciona em Safari antigo e novo
    const load = async (arquivo) => {
      if (!cache.has(arquivo)) {
        cache.set(arquivo, (async () => {
          const r = await buscar(new URL(arquivo, base), `amostra ${arquivo}`);
          const ab = await decode(await r.arrayBuffer());
          const L = ab.getChannelData(0).slice();
          const R = ab.numberOfChannels > 1 ? ab.getChannelData(1).slice() : L;
          return { L, R, len: ab.length };
        })());
      }
      return cache.get(arquivo);
    };
    const camadas = async (cs) => Promise.all(cs.map(async (c) => ({ ate: c.ate, amostras: await Promise.all(c.amostras.map(async (a) => ({ ...(await load(a.arquivo)), ganho: a.ganho ?? 1 }))) })));
    const kit = { golpes: {} };
    for (const [g, d] of Object.entries(def.golpes)) {
      const out = { trim: d.trim ?? 1 };
      if (d.usa) out.usa = d.usa;
      if (d.camadas) out.camadas = await camadas(d.camadas);
      if (d.variacoes) {
        out.variacoes = {};
        for (const [v, vd] of Object.entries(d.variacoes)) out.variacoes[v] = { trim: vd.trim, camadas: await camadas(vd.camadas) };
      }
      kit.golpes[g] = out;
    }
    const ok = new Promise((res) => { this._kitOk = res; });
    this.send({ type: 'kit', kit });
    await ok;
    this.kitInfo = { id: def.id, nome: def.nome, origem: def.origem, observacoes: def.observacoes || [], amostras: cache.size };
    return this.kitInfo;
  }

  // ---------- tempo: quadro de áudio → instante em que sai no alto-falante ----------
  // Usa getOutputTimestamp (contextTime em reprodução ↔ performance.now) quando disponível.
  frameToPerf(frame) {
    const sr = this.ctx.sampleRate, ct = frame / sr;
    const ts = this.ctx.getOutputTimestamp ? this.ctx.getOutputTimestamp() : null;
    if (ts && ts.performanceTime > 0 && ts.contextTime > 0) return ts.performanceTime + (ct - ts.contextTime) * 1000;
    const lat = (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0);
    return performance.now() + (ct - this.ctx.currentTime + lat) * 1000;
  }

  latencias() {
    const c = this.ctx;
    return {
      sampleRate: c ? c.sampleRate : null,
      baseLatency: c && 'baseLatency' in c ? c.baseLatency : null,
      outputLatency: c && 'outputLatency' in c ? c.outputLatency : null,
      estado: c ? c.state : 'não iniciado',
    };
  }

  // Toca um golpe imediatamente e devolve o quadro em que ele começou.
  hitNow(golpe = 'S') {
    const id = this._reqId++;
    return new Promise((res) => { this._hitWaiters.set(id, res); this.send({ type: 'hitNow', id, golpe }); });
  }

  request(type, extra = {}) {
    const id = this._reqId++;
    return new Promise((res) => { this._hitWaiters.set(id, res); this.send({ type, id, ...extra }); });
  }

  _onMessage(m) {
    if (m.type === 'kit-ok') { if (this._kitOk) this._kitOk(); return; }
    if (m.type === 'ready') { this.info.globalFrame = m.globalFrame; this.info.motor = m.motor; this.info.motorOk = m.motor === MOTOR; }
    if (m.id && this._hitWaiters.has(m.id)) { const r = this._hitWaiters.get(m.id); this._hitWaiters.delete(m.id); r(m); return; }
    this.dispatchEvent(new CustomEvent(m.type, { detail: m }));
  }
}
