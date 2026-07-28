import { MODULE_ID, MODULE_STAGE, MODULE_VERSION } from "../constants.mjs";
import { ProtectedTransactionDialogService } from "../services/protected-transaction-dialog-service.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function nativeCompendiumBrowserClass() {
  return game.dnd5e?.applications?.CompendiumBrowser
    ?? globalThis.dnd5e?.applications?.CompendiumBrowser
    ?? null;
}

function isSpellItemDocument(document) {
  const documentName = document?.documentName ?? document?.constructor?.documentName;
  return documentName === "Item" && document?.type === "spell";
}

function rootElement(element, app) {
  return element instanceof HTMLElement ? element : element?.[0] ?? app?.element ?? null;
}

/**
 * A focused GM utility that sends a Spell through D&D5e's native Spell Scroll
 * factory and creates the result as a World Item rather than an owned Actor Item.
 */
export class ScrollFactoryApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.busy = false;
    this.browserOpen = false;
    this.lastCreated = null;
    this.status = "Drop a Spell or browse the active Spell compendiums.";
  }

  static DEFAULT_OPTIONS = {
    id: "dnd5e-scroll-factory",
    classes: ["item-creator", "scroll-factory", "standard-form"],
    tag: "section",
    position: { width: 760, height: 620 },
    window: { title: "Scroll Factory", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/scroll-factory.hbs` }
  };

  async _prepareContext() {
    const created = this.lastCreated ? game.items.get(this.lastCreated.id) ?? this.lastCreated : null;
    return {
      version: MODULE_VERSION,
      stage: MODULE_STAGE,
      busy: this.busy,
      status: this.status,
      lastCreated: created ? {
        id: created.id,
        name: created.name,
        img: created.img,
        type: created.system?.type?.value ?? "scroll"
      } : null
    };
  }

  _onRender(_context, _options) {
    const root = this.element;
    const dropZone = root?.querySelector("[data-scroll-drop-zone]");
    dropZone?.addEventListener("dragover", event => this.#onDragOver(event));
    dropZone?.addEventListener("dragleave", event => this.#onDragLeave(event));
    dropZone?.addEventListener("drop", event => this.#onDrop(event));
    root?.querySelector('[data-action="browse-scroll-spells"]')
      ?.addEventListener("click", event => this.#browseSpells(event));
    root?.querySelector('[data-action="open-created-scroll"]')
      ?.addEventListener("click", event => this.#openCreatedScroll(event));
  }

  #onDragOver(event) {
    if (this.busy) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    event.currentTarget.classList.add("drag-over");
  }

  #onDragLeave(event) {
    event.currentTarget.classList.remove("drag-over");
  }

  async #onDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.remove("drag-over");
    if (this.busy) return;

    try {
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      if (data?.type !== "Item") {
        ui.notifications.warn("Drop a Spell Item into the Scroll Factory.");
        return;
      }
      const item = await Item.implementation.fromDropData(data);
      if (!isSpellItemDocument(item)) {
        ui.notifications.warn("Only Spell Items can be converted into Spell Scrolls.");
        return;
      }
      await this.#createScroll(item);
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to process the dropped Spell.`, error);
      ui.notifications.error("Scroll Factory could not read the dropped Spell.");
    }
  }

  async #browseSpells(event) {
    event.preventDefault();
    if (this.busy || this.browserOpen) return;
    const CompendiumBrowser = nativeCompendiumBrowserClass();
    if (!CompendiumBrowser?.selectOne) {
      ui.notifications.error("The native D&D5e Compendium Browser is unavailable.");
      return;
    }

    this.browserOpen = true;
    try {
      const uuid = await CompendiumBrowser.selectOne({
        mode: CompendiumBrowser.MODES?.ADVANCED ?? 2,
        tab: "spells",
        hint: "Select a Spell to create as a Spell Scroll in the World Items Directory.",
        filters: { locked: { documentClass: "Item", types: new Set(["spell"]) } },
        window: { modal: true }
      });
      if (!uuid) return;
      const spell = await fromUuid(uuid);
      if (!isSpellItemDocument(spell)) {
        ui.notifications.warn("Only Spell Items can be converted into Spell Scrolls.");
        return;
      }
      await this.#createScroll(spell);
    } catch (error) {
      console.error(`${MODULE_ID} | Native Spell Browser failed.`, error);
      ui.notifications.error("Scroll Factory could not open the D&D5e Spell Browser.");
    } finally {
      this.browserOpen = false;
    }
  }

  async #createScroll(spell) {
    if (this.busy) return;
    const ItemClass = Item.implementation ?? CONFIG.Item.documentClass;
    if (!(ItemClass?.createScrollFromSpell instanceof Function)) {
      ui.notifications.error("The installed D&D5e system does not expose its native Spell Scroll factory.");
      return;
    }

    const baseLevel = Math.max(0, Number(spell.system?.level) || 0);
    this.busy = true;
    this.status = `Preparing a native Spell Scroll for ${spell.name}…`;
    this.render({ force: true });

    try {
      const scroll = await ProtectedTransactionDialogService.runNativeModal({
        matchClass: "create-scroll",
        onRender: (_app, element) => this.#lockNativeLevel(rootElement(element, _app), baseLevel),
        operation: () => ItemClass.createScrollFromSpell(spell, {}, { level: baseLevel })
      });
      if (!scroll) {
        this.status = "Scroll creation was cancelled.";
        return;
      }

      const created = await ProtectedTransactionDialogService.runProcessing({
        title: "Creating Spell Scroll…",
        message: `Saving Spell Scroll: ${spell.name} to the World Items Directory.`,
        operation: () => ItemClass.create(scroll)
      });
      if (!created) throw new Error("D&D5e did not return a created World Item.");

      this.lastCreated = { id: created.id, name: created.name, img: created.img, system: created.system };
      this.status = `${created.name} was created in the World Items Directory.`;
      ui.notifications.info(`${created.name} created in World Items.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Native Spell Scroll creation failed.`, error);
      this.status = "The Spell Scroll could not be created.";
      ui.notifications.error("Scroll Factory could not create that Spell Scroll.");
    } finally {
      this.busy = false;
      this.render({ force: true });
    }
  }

  #lockNativeLevel(root, baseLevel) {
    if (!root) return;
    const levelControl = root.querySelector('[name="level"]');
    if (!levelControl) return;

    levelControl.value = String(baseLevel);
    levelControl.disabled = true;
    levelControl.dataset.tooltip = "Scroll Factory creates the Spell at its base level.";

    const fields = levelControl.closest(".form-fields") ?? levelControl.parentElement;
    if (fields && !fields.querySelector('[data-scroll-factory-base-level]')) {
      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = "level";
      hidden.value = String(baseLevel);
      hidden.dataset.scrollFactoryBaseLevel = "true";
      fields.append(hidden);
    }

    const group = levelControl.closest(".form-group");
    if (group && !group.querySelector(".ic-scroll-native-level-note")) {
      const note = document.createElement("p");
      note.className = "hint ic-scroll-native-level-note";
      note.textContent = "Scroll Factory uses the Spell's base level; upcasting is not applied.";
      group.append(note);
    }
  }

  #openCreatedScroll(event) {
    event.preventDefault();
    const item = this.lastCreated?.id ? game.items.get(this.lastCreated.id) : null;
    if (!item) {
      ui.notifications.warn("The last created Scroll is no longer available in World Items.");
      return;
    }
    item.sheet?.render?.({ force: true });
  }
}
