// Browser-compatible stand-in for Node's node:async_hooks module.
// LangGraph uses AsyncLocalStorage to thread context through async calls.
// JavaScript's single-threaded event loop makes a simple implementation safe.

export class AsyncLocalStorage<T> {
  private storage: T | undefined;

  getStore(): T | undefined {
    return this.storage;
  }

  run<R>(store: T, callback: (...args: unknown[]) => R, ...args: unknown[]): R {
    const previous = this.storage;
    this.storage = store;
    try {
      const result = callback(...args);
      if (result instanceof Promise) {
        return result.finally(() => {
          this.storage = previous;
        }) as unknown as R;
      }
      this.storage = previous;
      return result;
    } catch (e) {
      this.storage = previous;
      throw e;
    }
  }

  enterWith(store: T): void {
    this.storage = store;
  }

  exit<R>(callback: (...args: unknown[]) => R, ...args: unknown[]): R {
    return this.run(undefined as unknown as T, callback, ...args);
  }
}

export function createHook() {
  return { enable() {}, disable() {} };
}
