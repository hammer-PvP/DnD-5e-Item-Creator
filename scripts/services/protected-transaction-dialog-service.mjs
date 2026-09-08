import { MODULE_ID } from "../constants.mjs";

export class ProtectedTransactionDialogService {
  static #active = null;

  static async confirm({ key, matchClass, dialogOptions, visualBackdrop = true, containKeyboard = false } = {}) {
    if (!key || !matchClass || !dialogOptions) throw new Error("Protected confirmation requires key, matchClass, and dialogOptions.");
    if (this.#active) {
      this.#sync(this.#active, true);
      return false;
    }
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2?.confirm) return false;

    const active = {
      key, matchClass, app: null, element: null, blocked: new Map(), released: false, containKeyboard,
      backdrop: this.#backdrop(visualBackdrop), renderHook: null, pointerHandler: null, focusHandler: null, keyHandler: null, submitting: false
    };
    this.#active = active;
    document.body.append(active.backdrop);
    document.body.classList.add("ic-protected-active");

    active.pointerHandler = event => {
      if (active.released || active.element?.contains?.(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.#sync(active, true);
    };
    active.focusHandler = event => {
      if (active.released || active.element?.contains?.(event.target)) return;
      event.stopImmediatePropagation();
      this.#sync(active, true);
    };
    document.addEventListener("pointerdown", active.pointerHandler, true);
    document.addEventListener("click", active.pointerHandler, true);
    document.addEventListener("focusin", active.focusHandler, true);
    active.keyHandler = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.#sync(active, true);
    };
    document.addEventListener("keydown", active.keyHandler, true);

    active.renderHook = Hooks.on("renderApplicationV2", app => {
      if (app?.element?.classList?.contains(matchClass)) {
        active.app = app;
        active.element = app.element;
        this.#unblock(active, active.element);
        if (active.containKeyboard) active.element.addEventListener("keydown", event => event.stopPropagation());
        active.element.addEventListener("click", event => {
          const button = event.target?.closest?.("footer button, .form-footer button");
          if (!button) return;
          if (active.submitting) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
          active.submitting = true;
          queueMicrotask(() => active.element?.querySelectorAll?.("footer button, .form-footer button").forEach(control => { control.disabled = true; }));
        }, true);
        this.#sync(active, true);
      }
      this.#block(active);
    });
    this.#block(active);

    try {
      return Boolean(await DialogV2.confirm(dialogOptions));
    } finally {
      this.#release(active);
    }
  }

  static async runProtectedApplication({ key, matchClass, operation, containKeyboard = false, attentionFeedback = false } = {}) {
    if (!key || !matchClass || !(operation instanceof Function)) {
      throw new Error("Protected application requires key, matchClass, and operation.");
    }
    if (this.#active) {
      this.#attention(this.#active);
      this.#sync(this.#active, true);
      return false;
    }

    const active = {
      key,
      matchClass,
      app: null,
      element: null,
      blocked: new Map(),
      released: false,
      containKeyboard,
      attentionFeedback,
      backdrop: null,
      renderHook: null,
      pointerHandler: null,
      focusHandler: null,
      keyHandler: null,
      submitting: false,
      attentionTimer: null,
      lastAttentionAt: 0
    };
    this.#active = active;
    document.body.classList.add("ic-protected-active");

    active.pointerHandler = event => {
      if (active.released || active.element?.contains?.(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.#attention(active);
      this.#sync(active, true);
    };
    active.focusHandler = event => {
      if (active.released || active.element?.contains?.(event.target)) return;
      event.preventDefault?.();
      event.stopImmediatePropagation();
      this.#attention(active);
      this.#sync(active, true);
    };
    active.keyHandler = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.#attention(active);
      this.#sync(active, true);
    };
    document.addEventListener("pointerdown", active.pointerHandler, true);
    document.addEventListener("click", active.pointerHandler, true);
    document.addEventListener("focusin", active.focusHandler, true);
    document.addEventListener("keydown", active.keyHandler, true);

    active.renderHook = Hooks.on("renderApplicationV2", app => {
      if (app?.element?.classList?.contains(matchClass)) {
        active.app = app;
        active.element = app.element;
        this.#unblock(active, active.element);
        if (active.containKeyboard) active.element.addEventListener("keydown", event => event.stopPropagation());
        this.#sync(active, true);
      }
      this.#block(active);
    });
    this.#block(active);

    try {
      return Boolean(await operation());
    } finally {
      this.#release(active);
    }
  }

  static async runNativeModal({ matchClass, operation, onRender = null } = {}) {
    if (!matchClass || !(operation instanceof Function)) {
      throw new Error("Protected native modal requires matchClass and operation.");
    }
    if (this.#active) {
      this.#sync(this.#active, true);
      return null;
    }

    const active = {
      key: `native:${matchClass}`,
      matchClass,
      app: null,
      element: null,
      blocked: new Map(),
      released: false,
      backdrop: this.#backdrop(),
      renderHook: null,
      pointerHandler: null,
      focusHandler: null,
      keyHandler: null,
      submitting: false
    };
    this.#active = active;
    document.body.append(active.backdrop);
    document.body.classList.add("ic-protected-active");

    active.pointerHandler = event => {
      if (active.released || active.element?.contains?.(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.#sync(active, true);
    };
    active.focusHandler = event => {
      if (active.released || active.element?.contains?.(event.target)) return;
      event.stopImmediatePropagation();
      this.#sync(active, true);
    };
    active.keyHandler = event => {
      if (event.key !== "Escape") return;
      if (active.element?.contains?.(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.#sync(active, true);
    };
    document.addEventListener("pointerdown", active.pointerHandler, true);
    document.addEventListener("click", active.pointerHandler, true);
    document.addEventListener("focusin", active.focusHandler, true);
    document.addEventListener("keydown", active.keyHandler, true);

    active.renderHook = Hooks.on("renderApplicationV2", app => {
      const element = app?.element;
      if (element?.classList?.contains(matchClass)) {
        active.app = app;
        active.element = element;
        this.#unblock(active, element);
        try { onRender?.(app, element); }
        catch (error) { console.warn(`${MODULE_ID} | Protected native modal render callback failed.`, error); }
        this.#sync(active, true);
      }
      this.#block(active);
    });
    this.#block(active);

    try {
      return await operation();
    } finally {
      this.#release(active);
    }
  }

  static async runProcessing({ title = "Creating Item…", message = "Building the Item, Activities, and Active Effects. Please wait.", operation } = {}) {
    if (!(operation instanceof Function)) throw new Error("A processing operation is required.");
    const overlay = document.createElement("div");
    overlay.className = "ic-processing-overlay";
    overlay.innerHTML = `<section class="ic-processing-card" role="alertdialog" aria-modal="true"><i class="fa-solid fa-spinner fa-spin"></i><h2>${foundry.utils.escapeHTML(title)}</h2><p>${foundry.utils.escapeHTML(message)}</p></section>`;
    document.body.append(overlay);
    const blocked = new Map();
    const keyHandler = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener("keydown", keyHandler, true);
    for (const element of document.querySelectorAll(".application")) {
      blocked.set(element, Boolean(element.inert));
      element.inert = true;
    }
    try {
      return await operation();
    } finally {
      overlay.remove();
      document.removeEventListener("keydown", keyHandler, true);
      for (const [element, inert] of blocked) if (element.isConnected) element.inert = inert;
    }
  }

  static #backdrop(visual = true) {
    const element = document.createElement("div");
    element.className = `ic-protected-backdrop${visual ? "" : " ic-protected-backdrop-transparent"}`;
    element.dataset.moduleId = MODULE_ID;
    return element;
  }

  static #block(active) {
    for (const element of document.querySelectorAll(".application")) {
      if (element === active.element || element.classList.contains(active.matchClass)) continue;
      if (!active.blocked.has(element)) active.blocked.set(element, Boolean(element.inert));
      element.inert = true;
      element.classList.add("ic-protected-blocked");
    }
  }

  static #unblock(active, element) {
    if (!active.blocked.has(element)) return;
    element.inert = active.blocked.get(element);
    element.classList.remove("ic-protected-blocked");
    active.blocked.delete(element);
  }

  static #sync(active, focus = false) {
    if (!active || active.released) return;
    this.#block(active);
    if (!active.element?.isConnected) return;
    active.app?.bringToFront?.();
    let max = 0;
    for (const element of document.querySelectorAll(".application")) {
      if (element === active.element) continue;
      const z = Number.parseInt(element.style.zIndex || getComputedStyle(element).zIndex, 10);
      if (Number.isFinite(z)) max = Math.max(max, z);
    }
    if (active.backdrop) active.backdrop.style.zIndex = String(max + 1);
    active.element.style.zIndex = String(max + 2);
    if (focus) (active.element.querySelector("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])") ?? active.element).focus?.({ preventScroll: true });
  }

  static #attention(active) {
    if (!active?.attentionFeedback || active.released || !active.element?.isConnected) return;
    const now = Date.now();
    if (now - Number(active.lastAttentionAt || 0) < 120) return;
    active.lastAttentionAt = now;
    if (active.attentionTimer) clearTimeout(active.attentionTimer);
    active.element.classList.remove("ic-protected-attention");
    void active.element.offsetWidth;
    active.element.classList.add("ic-protected-attention");
    active.attentionTimer = setTimeout(() => {
      active.element?.classList?.remove("ic-protected-attention");
      active.attentionTimer = null;
    }, 240);
  }

  static #release(active) {
    if (!active || active.released) return;
    active.released = true;
    if (active.attentionTimer) clearTimeout(active.attentionTimer);
    active.element?.classList?.remove("ic-protected-attention");
    if (active.renderHook !== null) Hooks.off("renderApplicationV2", active.renderHook);
    document.removeEventListener("pointerdown", active.pointerHandler, true);
    document.removeEventListener("click", active.pointerHandler, true);
    document.removeEventListener("focusin", active.focusHandler, true);
    document.removeEventListener("keydown", active.keyHandler, true);
    active.backdrop?.remove();
    for (const [element, inert] of active.blocked) if (element.isConnected) {
      element.inert = inert;
      element.classList.remove("ic-protected-blocked");
    }
    document.body.classList.remove("ic-protected-active");
    if (this.#active === active) this.#active = null;
  }
}
