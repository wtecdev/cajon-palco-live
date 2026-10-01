// Pedais: Web MIDI (Android/Chrome) e pedal em modo teclado/HID (todos os aparelhos).
// O mesmo mapeamento A/B/C/D vale para os dois modos; cada letra pode ter uma tecla e um sinal MIDI.

export const LETRAS = ['A', 'B', 'C', 'D'];
const GUARDA_MS = 150; // ignora repique mecânico do mesmo sinal

export class PedalInput extends EventTarget {
  constructor(mapa) {
    super();
    this.mapa = mapa; // { A: { tecla: 'KeyA', midi: {sig:'cc:1:64', modo:'pisar'} }, ... }
    this.aprendendo = null; // { letra, tipo: 'tecla' | 'midi' }
    this.midi = null;
    this.entradas = [];
    this.ultimo = {};
    this.log = [];
    this._onKey = this._onKey.bind(this);
    window.addEventListener('keydown', this._onKey, true);
  }

  get midiSuportado() { return typeof navigator.requestMIDIAccess === 'function'; }

  aprender(letra, tipo) { this.aprendendo = letra ? { letra, tipo } : null; this._emit('aprendendo', this.aprendendo); }

  limpar(letra, tipo) { if (this.mapa[letra]) this.mapa[letra][tipo] = null; this._emit('mapa', this.mapa); }

  _onKey(e) {
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.repeat) { if (this._letraDaTecla(e.code)) e.preventDefault(); return; }
    if (this.aprendendo && this.aprendendo.tipo === 'tecla') {
      if (e.code === 'Escape') { this.aprender(null); return; }
      for (const l of LETRAS) if (this.mapa[l] && this.mapa[l].tecla === e.code) this.mapa[l].tecla = null;
      this.mapa[this.aprendendo.letra].tecla = e.code;
      this._log('tecla', e.code, this.aprendendo.letra, e.timeStamp);
      this.aprendendo = null;
      e.preventDefault();
      this._emit('mapa', this.mapa); this._emit('aprendendo', null);
      return;
    }
    const letra = this._letraDaTecla(e.code);
    this._log('tecla', e.code, letra, e.timeStamp);
    if (!letra) { this._emit('tecla', { code: e.code, t: e.timeStamp }); return; }
    e.preventDefault(); // evita rolar a tela com espaço/setas de pedal virador de página
    this._pisar(letra, e.timeStamp, 'teclado', e.code);
  }

  _letraDaTecla(code) { return LETRAS.find((l) => this.mapa[l] && this.mapa[l].tecla === code) || null; }

  // Precisa de gesto do usuário na primeira vez (o Chrome pede permissão).
  async conectarMidi() {
    if (!this.midiSuportado) throw new Error('Web MIDI não existe neste navegador (Safari/iOS não tem). Use o pedal em modo teclado.');
    this.midi = await navigator.requestMIDIAccess({ sysex: false });
    const liga = () => {
      this.entradas = Array.from(this.midi.inputs.values());
      for (const inp of this.entradas) inp.onmidimessage = (ev) => this._onMidi(ev, inp);
      this._emit('midi', this.entradas.map((i) => ({ id: i.id, nome: i.name, estado: i.state })));
    };
    this.midi.onstatechange = liga;
    liga();
  }

  _onMidi(ev, inp) {
    const [st = 0, d1 = 0, d2 = 0] = ev.data;
    const cmd = st & 0xf0, ch = (st & 0x0f) + 1;
    let tipo = null, sig = null, valor = d2;
    if (cmd === 0x90) { tipo = 'nota'; sig = `nota:${ch}:${d1}`; if (d2 === 0) tipo = 'nota-off'; }
    else if (cmd === 0x80) { tipo = 'nota-off'; sig = `nota:${ch}:${d1}`; }
    else if (cmd === 0xb0) { tipo = 'cc'; sig = `cc:${ch}:${d1}`; }
    else if (cmd === 0xc0) { tipo = 'pc'; sig = `pc:${ch}:${d1}`; valor = 127; }
    if (!sig) return;
    const t = ev.timeStamp;
    if (this.aprendendo && this.aprendendo.tipo === 'midi') {
      if (tipo === 'nota-off' || (tipo === 'cc' && valor === 0)) return; // aprende no pisar
      for (const l of LETRAS) if (this.mapa[l] && this.mapa[l].midi && this.mapa[l].midi.sig === sig) this.mapa[l].midi = null;
      this.mapa[this.aprendendo.letra].midi = { sig, modo: 'pisar' };
      this._log('midi', `${sig} v${valor} (${inp.name})`, this.aprendendo.letra, t);
      this.aprendendo = null;
      this._emit('mapa', this.mapa); this._emit('aprendendo', null);
      return;
    }
    const letra = LETRAS.find((l) => this.mapa[l] && this.mapa[l].midi && this.mapa[l].midi.sig === sig) || null;
    this._log('midi', `${sig} v${valor} (${inp.name})`, letra, t);
    if (!letra) return;
    const modo = this.mapa[letra].midi.modo || 'pisar';
    // 'pisar': só a mensagem de apertar (nota on / CC > 0). 'qualquer': toda mensagem do sinal
    // (para pedais que alternam 127/0 a cada pisada).
    if (modo === 'pisar' && (tipo === 'nota-off' || (tipo === 'cc' && valor === 0))) return;
    this._pisar(letra, t, 'midi', sig);
  }

  // Botões na tela usam o mesmo caminho.
  tela(letra, t) { this._pisar(letra, t, 'tela', 'toque'); }

  _pisar(letra, t, fonte, detalhe) {
    const k = `${fonte}:${letra}`;
    if (t - (this.ultimo[k] ?? -1e9) < GUARDA_MS) return;
    this.ultimo[k] = t;
    this._emit('pedal', { letra, t, fonte, detalhe });
  }

  _log(fonte, detalhe, letra, t) {
    this.log.unshift({ fonte, detalhe, letra, t });
    if (this.log.length > 30) this.log.pop();
    this._emit('log', this.log);
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}

export const MAPA_PADRAO = () => ({
  A: { tecla: 'KeyA', midi: null },
  B: { tecla: 'KeyB', midi: null },
  C: { tecla: 'KeyC', midi: null },
  D: { tecla: 'KeyD', midi: null },
});
