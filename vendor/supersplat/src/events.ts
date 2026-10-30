import { EventHandler } from 'playcanvas';

type FunctionCallback = (...args: any[]) => any;

class Events extends EventHandler {
    functions = new Map<string, FunctionCallback>();
    root: ShadowRoot;
    active = true;
    private abort = new AbortController();
    private cleanups: (() => void)[] = [];
    private listeners: { target: EventTarget, actual: EventTarget, type: string, fn: any, wrapped: any, capture: boolean }[] = [];

    constructor(root: ShadowRoot) { super(); this.root = root; }

    // SceneLoom: native DOM listeners belong to this editor, never to the page.
    listen(target: EventTarget, type: string, fn: any, options: any = {}) {
        const scoped = target === window || target === document;
        const global = ['beforeunload', 'blur', 'resize', 'visibilitychange'].includes(type);
        const actual = scoped && !global ? this.root : target;
        const opts = typeof options === 'boolean' ? { capture: options } : options;
        const wrapped = (e: Event) => { if (this.active || global) fn(e); };
        actual.addEventListener(type, wrapped, { ...opts, signal: this.abort.signal });
        this.listeners.push({ target, actual, type, fn, wrapped, capture: !!opts.capture });
    }

    unlisten(target: EventTarget, type: string, fn: any, options: any = {}) {
        const capture = typeof options === 'boolean' ? options : !!options.capture;
        this.listeners = this.listeners.filter((entry) => {
            if (entry.target !== target || entry.type !== type || entry.fn !== fn || entry.capture !== capture) return true;
            entry.actual.removeEventListener(type, entry.wrapped, capture); return false;
        });
    }

    cleanup(fn: () => void) { this.cleanups.push(fn); }
    dispose() { this.active = false; this.abort.abort(); this.cleanups.splice(0).forEach(fn => fn()); this.listeners = []; this.functions.clear(); this.off(); }

    // declare an editor function
    function(name: string, fn: FunctionCallback) {
        if (this.functions.has(name)) {
            throw new Error(`error: function ${name} already exists`);
        }
        this.functions.set(name, fn);
    }

    // invoke an editor function
    invoke(name: string, ...args: any[]) {
        const fn = this.functions.get(name);
        if (!fn) {
            console.error(`error: function not found '${name}'`);
            return;
        }
        return fn(...args);
    }
}

export { Events };
