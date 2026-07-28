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

    const sourceLevel = Number(spell.system?.level);
    if (!Number.isFinite(sourceLevel)) {
      ui.notifications.error("The selected Spell does not have a valid numeric Spell level.");
      return;
    }
    const baseLevel = Math.max(0, Math.trunc(sourceLevel));
    this.busy = true;
    this.status = `Preparing a native Spell Scroll for ${spell.name}…`;
    this.render({ force: true });

    try {
      const scroll = await this.#withLockedScrollLevel(spell, baseLevel, () =>
        ProtectedTransactionDialogService.runNativeModal({
          matchClass: "create-scroll",
          onRender: (_app, element) => this.#lockNativeLevel(rootElement(element, _app), baseLevel),
          operation: () => ItemClass.createScrollFromSpell(spell, {}, { level: baseLevel })
        })
      );
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

  async #withLockedScrollLevel(spell, baseLevel, operation) {
    const normalizedLevel = Number(baseLevel);
    if (!Number.isFinite(normalizedLevel)) throw new Error("The source Spell does not have a valid numeric level.");

    const hookIds = [];
    const register = (name, callback) => hookIds.push([name, Hooks.on(name, callback)]);

    // D&D5e normally converts the dialog field to a Number. The Factory also
    // normalizes at every native hook boundary so custom form controls or
    // partial dialog renders can never leave CastActivity.spell.level as a
    // string, an array, undefined, or NaN.
    register("dnd5e.preCreateScrollFromCompendiumSpell", (_sourceSpell, config) => {
      config.level = normalizedLevel;
      config.values ??= {};
    });
    register("dnd5e.preCreateScrollFromSpell", (itemData, _options, config) => {
      config.level = normalizedLevel;
      config.values ??= {};
      if (itemData?.system) itemData.system.level = normalizedLevel;
    });
    register("dnd5e.createScrollFromSpell", (_sourceSpell, scrollData, config) => {
      config.level = normalizedLevel;
      const activities = scrollData?.system?.activities ?? {};
      for (const activity of Object.values(activities)) {
        if (activity?.type !== "cast" || !activity.spell) continue;
        activity.spell.level = normalizedLevel;
      }
    });

    try {
      return await operation();
    } finally {
      for (const [name, id] of hookIds) Hooks.off(name, id);
    }
  }

  #lockNativeLevel(root, baseLevel) {
    if (!root) return;
    const levelControl = root.querySelector('[name="level"]');
    if (!levelControl) return;

    const normalizedLevel = Number(baseLevel);
    if (!Number.isFinite(normalizedLevel)) return;
    const serializedLevel = String(normalizedLevel);

    // Keep the native field enabled so D&D5e's FormDataExtended and NumberField
    // serialization remain intact. A disabled field plus a duplicate hidden
    // field can serialize as a string/array and fail CastActivity validation.
    levelControl.disabled = false;
    levelControl.value = serializedLevel;
    levelControl.dataset.tooltip = "Scroll Factory creates the Spell at its base level.";
    levelControl.setAttribute("aria-label", "Spell base level");

    if (levelControl instanceof HTMLSelectElement) {
      for (const option of [...levelControl.options]) {
        if (Number(option.value) !== normalizedLevel) option.remove();
      }
      if (![...levelControl.options].some(option => Number(option.value) === normalizedLevel)) {
        levelControl.add(new Option(`Level ${normalizedLevel}`, serializedLevel, true, true));
      }
      levelControl.value = serializedLevel;
    } else if (levelControl instanceof HTMLInputElement) {
      levelControl.min = serializedLevel;
      levelControl.max = serializedLevel;
      levelControl.step = "1";
      levelControl.readOnly = true;
    }

    if (!levelControl.dataset.scrollFactoryLockBound) {
      const restore = event => {
        event.currentTarget.value = serializedLevel;
      };
      levelControl.addEventListener("input", restore);
      levelControl.addEventListener("change", restore);
      levelControl.dataset.scrollFactoryLockBound = "true";
    }

    // Remove the obsolete duplicate input from v0.1.8d if a partial rerender
    // retained it in the dialog DOM.
    root.querySelectorAll('[data-scroll-factory-base-level]').forEach(element => element.remove());

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
