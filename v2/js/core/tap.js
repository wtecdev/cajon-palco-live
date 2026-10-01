// Tap tempo: média móvel dos últimos intervalos, descartando toques fora da curva.

export class TapTempo {
  constructor({ janela = 6, resetMs = 2000, minToques = 3 } = {}) {
    this.janela = janela; this.resetMs = resetMs; this.minToques = minToques;
    this.toques = [];
  }

  // t em ms (use event.timeStamp). Retorna BPM (1 casa decimal) ou null se ainda não há toques suficientes.
  tap(t) {
    const last = this.toques[this.toques.length - 1];
    if (last != null && (t - last > this.resetMs || t <= last)) this.toques = [];
    this.toques.push(t);
    if (this.toques.length > this.janela + 1) this.toques.shift();
    if (this.toques.length < this.minToques) return null;
    const iv = this.toques.slice(1).map((x, i) => x - this.toques[i]);
    const med = [...iv].sort((a, b) => a - b)[Math.floor(iv.length / 2)];
    // fora da curva: mais de 25% longe da mediana (toque duplo, toque perdido)
    const bons = iv.filter((x) => Math.abs(x - med) <= med * 0.25);
    if (bons.length < this.minToques - 1) return null;
    const media = bons.reduce((a, b) => a + b, 0) / bons.length;
    return Math.round((60000 / media) * 10) / 10;
  }

  reset() { this.toques = []; }
}
