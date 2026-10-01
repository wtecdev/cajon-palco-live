// Mantém a tela acesa (Screen Wake Lock). No iOS/iPadOS funciona em app da tela de início a partir do 18.4.

export class TelaAcesa extends EventTarget {
  constructor() {
    super();
    this.lock = null;
    this.desejado = false;
    this.estado = 'wakeLock' in navigator ? 'desligado' : 'sem suporte';
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && this.desejado) this.pedir(); });
  }

  async pedir() {
    this.desejado = true;
    if (!('wakeLock' in navigator)) return this._set('sem suporte');
    if (this.lock && !this.lock.released) return this._set('ativo');
    try {
      this.lock = await navigator.wakeLock.request('screen');
      this.lock.addEventListener('release', () => { this._set(document.visibilityState === 'visible' ? 'liberado pelo sistema' : 'aguardando voltar'); });
      this._set('ativo');
    } catch (e) {
      this._set(`negado (${e.name})`);
    }
  }

  _set(s) { this.estado = s; this.dispatchEvent(new CustomEvent('estado', { detail: s })); }
}
