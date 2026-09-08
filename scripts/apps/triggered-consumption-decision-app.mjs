import { MODULE_ID } from "../constants.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TriggeredConsumptionDecisionApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ title = "Use Effect?", content = "", useLabel = "Use", useIcon = "fa-solid fa-dice-d20", keepLabel = "Keep", keepIcon = "fa-solid fa-shield-halved" } = {}) {
    const dialogTitle = String(title || "Use Effect?");
    super({ window: { title: dialogTitle } });
    this.dialogTitle = dialogTitle;
    this.content = String(content || "");
    this.useLabel = String(useLabel || "Use");
    this.useIcon = String(useIcon || "fa-solid fa-dice-d20");
    this.keepLabel = String(keepLabel || "Keep");
    this.keepIcon = String(keepIcon || "fa-solid fa-shield-halved");
    this.settled = false;
    this.submitting = false;
    this.#decision = new Promise(resolve => { this.#resolveDecision = resolve; });
  }

  #decision;
  #resolveDecision;

  static DEFAULT_OPTIONS = {
    id: "item-creator-triggered-consumption-decision",
    classes: ["item-creator", "ic-triggered-consumption-dialog", "standard-form"],
    tag: "form",
    position: { width: 390 },
    window: { title: "Use Effect?", resizable: false }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/triggered-consumption-decision.hbs` }
  };

  async _prepareContext() {
    return {
      content: this.content,
      useLabel: this.useLabel,
      useIcon: this.useIcon,
      keepLabel: this.keepLabel,
      keepIcon: this.keepIcon
    };
  }

  _onRender() {
    const root = this.element;
    root?.querySelector('[data-action="use"]')?.addEventListener("click", event => this.#choose(event, true));
    root?.querySelector('[data-action="keep"]')?.addEventListener("click", event => this.#choose(event, false));
  }

  async waitForDecision() {
    await this.render({ force: true });
    return this.#decision;
  }

  async #choose(event, value) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (this.submitting || this.settled) return;
    this.submitting = true;
    this.element?.querySelectorAll?.('[data-action="use"], [data-action="keep"]').forEach(button => { button.disabled = true; });
    this.settled = true;
    this.#resolveDecision(Boolean(value));
    await super.close();
  }

  async close(options = {}) {
    if (!this.settled) {
      this.settled = true;
      this.#resolveDecision(false);
    }
    return super.close(options);
  }
}
