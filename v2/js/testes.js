// Testes de palco (seção 4.7): latência pedal → som e estabilidade do tempo.

const media = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const dp = (a) => { const m = media(a); return Math.sqrt(media(a.map((x) => (x - m) ** 2))); };
const f1 = (x) => (x == null || Number.isNaN(x) ? '—' : x.toFixed(1));

// ---------- Latência ----------
// Mede, para cada pisada: do instante em que o navegador recebeu o evento (event.timeStamp)
// até o instante em que o golpe sai no alto-falante segundo o próprio sistema
// (getOutputTimestamp/outputLatency). NÃO inclui o trajeto pedal → aparelho (Bluetooth/USB):
// para o número completo use a medição acústica (tools/medir_latencia.py).
export class TesteLatencia {
  constructor(engine) { this.engine = engine; this.amostras = []; this.ativo = false; }

  iniciar() { this.amostras = []; this.ativo = true; }
  parar() { this.ativo = false; }

  async pisada(evento) {
    if (!this.ativo) return null;
    const r = await this.engine.hitNow('S');
    const saida = this.engine.frameToPerf(r.frame);
    const total = saida - evento.t;
    const lat = this.engine.latencias();
    const a = { total, base: lat.baseLatency != null ? lat.baseLatency * 1000 : null, saida: lat.outputLatency != null ? lat.outputLatency * 1000 : null, fonte: evento.fonte, detalhe: evento.detalhe };
    this.amostras.push(a);
    return a;
  }

  resumo() {
    const t = this.amostras.map((a) => a.total);
    const ult = this.amostras[this.amostras.length - 1] || {};
    return { n: t.length, media: media(t), min: Math.min(...t), max: Math.max(...t), dp: dp(t), base: ult.base ?? null, saida: ult.saida ?? null };
  }

  relatorio(info) {
    const r = this.resumo();
    return [
      'TESTE DE LATÊNCIA — Cajón Palco Pro',
      `Aparelho: ${navigator.userAgent}`,
      `Taxa: ${info.sampleRate} Hz · baseLatency ${f1((info.baseLatency ?? NaN) * 1000)} ms · outputLatency ${f1((info.outputLatency ?? NaN) * 1000)} ms`,
      `Pisadas: ${r.n} · média ${f1(r.media)} ms · mín ${f1(r.min)} · máx ${f1(r.max)} · desvio ${f1(r.dp)}`,
      `Fonte: ${[...new Set(this.amostras.map((a) => a.fonte))].join(', ')}`,
      'Cada pisada (ms): ' + this.amostras.map((a) => f1(a.total)).join(' '),
      'Obs.: evento recebido → som no alto-falante (estimativa do sistema). Não inclui pedal → aparelho.',
    ].join('\n');
  }
}

// ---------- Estabilidade ----------
// Toca por N minutos e verifica: (1) cada tempo 1 no quadro exato da grade;
// (2) golpes atrasados (agendados tarde demais); (3) o relógio de áudio contra o relógio do
// sistema — se o áudio "trava" (tela apagou, notificação, sistema suspendeu), aparece como salto.
export class TesteEstabilidade extends EventTarget {
  constructor(engine) { super(); this.engine = engine; this.rodando = false; }

  async iniciar(minutos) {
    this.rodando = true;
    this.inicio = performance.now();
    this.fim = this.inicio + minutos * 60000;
    this.amostrasRelogio = [];
    this.engine.send({ type: 'stab-start' });
    this.timer = setInterval(() => this._amostrar(), 1000);
    this._amostrar();
  }

  _amostrar() {
    const c = this.engine.ctx;
    const ts = c.getOutputTimestamp ? c.getOutputTimestamp() : { contextTime: c.currentTime, performanceTime: performance.now() };
    if (ts.performanceTime > 0) this.amostrasRelogio.push({ p: ts.performanceTime, c: ts.contextTime, estado: c.state, visivel: document.visibilityState });
    const agora = performance.now();
    this.dispatchEvent(new CustomEvent('progresso', { detail: { passado: agora - this.inicio, total: this.fim - this.inicio } }));
    if (agora >= this.fim) this.concluir();
  }

  async concluir() {
    if (!this.rodando) return;
    this.rodando = false;
    clearInterval(this.timer);
    const rep = await this.engine.request('stab-report');
    this.engine.send({ type: 'stab-stop' });
    const sr = this.engine.ctx.sampleRate;
    const tr = rep.trace;
    // grade: diferença entre compassos consecutivos deve ser constante (mesmo BPM durante o teste)
    let erroGrade = 0;
    if (tr.length > 2) {
      const d = (tr[tr.length - 1] - tr[0]) / (tr.length - 1);
      tr.forEach((f, k) => { erroGrade = Math.max(erroGrade, Math.abs(f - (tr[0] + k * d))); });
    }
    // relógio: offset = performanceTime − contextTime×1000 deve variar suavemente
    const r = this.amostrasRelogio;
    let saltoMax = 0, saltos = 0, deriva = null;
    for (let i = 1; i < r.length; i++) {
      const off0 = r[i - 1].p - r[i - 1].c * 1000, off1 = r[i].p - r[i].c * 1000;
      const salto = Math.abs(off1 - off0);
      saltoMax = Math.max(saltoMax, salto);
      if (salto > 20) saltos++;
    }
    if (r.length > 10) {
      const dp_ = r[r.length - 1].p - r[0].p, dc = (r[r.length - 1].c - r[0].c) * 1000;
      deriva = ((dc - dp_) / dp_) * 1e6; // ppm
    }
    const res = {
      minutos: (performance.now() - this.inicio) / 60000,
      compassos: tr.length,
      erroGradeQuadros: erroGrade,
      erroGradeMs: (erroGrade / sr) * 1000,
      atrasados: rep.late,
      vozesRoubadas: rep.stolen,
      saltosRelogio: saltos,
      saltoMaxMs: saltoMax,
      derivaPpm: deriva,
      invisivel: r.some((x) => x.visivel !== 'visible'),
      suspenso: r.some((x) => x.estado !== 'running'),
    };
    res.passou = res.erroGradeQuadros < 1 && res.atrasados === 0 && res.saltosRelogio === 0 && !res.suspenso;
    this.dispatchEvent(new CustomEvent('fim', { detail: res }));
    return res;
  }

  cancelar() { if (this.rodando) { this.fim = performance.now(); this._amostrar(); } }
}

export function textoEstabilidade(r) {
  return [
    `RESULTADO: ${r.passou ? 'PASSOU' : 'FALHOU'}`,
    `Duração ${r.minutos.toFixed(1)} min · ${r.compassos} compassos`,
    `Erro máximo da grade: ${r.erroGradeQuadros.toFixed(6)} quadros (${r.erroGradeMs.toFixed(4)} ms)`,
    `Golpes atrasados: ${r.atrasados} · vozes roubadas: ${r.vozesRoubadas}`,
    `Relógio de áudio × sistema: ${r.saltosRelogio} salto(s) > 20 ms (maior ${r.saltoMaxMs.toFixed(1)} ms)` + (r.derivaPpm != null ? ` · diferença ${r.derivaPpm.toFixed(0)} ppm` : ''),
    r.suspenso ? 'ATENÇÃO: o áudio foi suspenso pelo sistema durante o teste.' : '',
    r.invisivel ? 'Obs.: o app saiu da tela durante o teste.' : '',
    'A diferença em ppm entre os relógios é do cristal do aparelho, não muda o andamento que você ouve.',
  ].filter(Boolean).join('\n');
}
