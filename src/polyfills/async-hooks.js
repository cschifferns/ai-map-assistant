// Browser-compatible stand-in for node:async_hooks.
// JavaScript's single-threaded event loop makes a simple stack safe here.

export class AsyncLocalStorage {
  constructor() { this._store = undefined; }

  getStore() { return this._store; }

  run(store, callback, ...args) {
    const prev = this._store;
    this._store = store;
    try {
      const result = callback(...args);
      if (result instanceof Promise) {
        return result.finally(() => { this._store = prev; });
      }
      this._store = prev;
      return result;
    } catch (e) {
      this._store = prev;
      throw e;
    }
  }

  enterWith(store) { this._store = store; }

  exit(callback, ...args) { return this.run(undefined, callback, ...args); }
}

export function createHook() {
  return { enable() {}, disable() {} };
}
