import { MODULE_ID, MODULE_VERSION, defaultSourceSettings } from "./constants.mjs";
import { ItemCreatorApp } from "./apps/item-creator-app.mjs";
import { ItemCreatorSettingsApp } from "./apps/settings-app.mjs";
import { ItemCreatorModuleSettingsApp } from "./apps/module-settings-app.mjs";
import { ScrollFactoryApp } from "./apps/scroll-factory-app.mjs";
import { ItemCreatorRuntimeEffectService } from "./services/runtime-effect-service.mjs";
import { MaterializationCore } from "./core/materialization/index.mjs";
import {
  getMaterializationSettings,
  priceForRarity,
  registerMaterializationSettings
} from "./core/materialization/pricing.mjs";
import { SupplierApplication } from "./features/supplier/supplier-app.mjs";
import { auditSupplierStock } from "./features/supplier/generator.mjs";
import { SupplierConfigApplication } from "./features/supplier/config-app.mjs";
import {
  getConfiguration as getSupplierConfiguration,
  initializeDefaultSources,
  isSupplierEnabled,
  registerSupplierSettings
} from "./features/supplier/settings.mjs";

let appInstance = null;
let scrollFactoryInstance = null;
let supplierInstance = null;
let supplierConfigInstance = null;
let sourceSettingsInstance = null;
let moduleSettingsInstance = null;

Hooks.once("init", () => {
  ItemCreatorRuntimeEffectService.registerHooks();
  console.log(`${MODULE_ID} | Initializing ${MODULE_VERSION}.`);

  game.settings.register(MODULE_ID, "sourceSettings", {
    name: "Item Creator Content Sources",
    hint: "Content sources used to find base items and icons.",
    scope: "world",
    config: false,
    type: Object,
    default: defaultSourceSettings()
  });

  registerMaterializationSettings();
  registerSupplierSettings();

  game.settings.registerMenu(MODULE_ID, "moduleConfiguration", {
    name: "Item Creator Configuration",
    label: "Configure Item Creator",
    hint: "Manage the optional Supplier stock generator and the shared Materialization Core pricing profile.",
    icon: "fa-solid fa-gears",
    type: ItemCreatorModuleSettingsApp,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "contentSources", {
    name: "Content Sources",
    label: "Configure Content Sources",
    hint: "Choose which installed content sources Item Creator can use for base items and icons, then arrange their priority.",
    icon: "fa-solid fa-books",
    type: ItemCreatorSettingsApp,
    restricted: true
  });

  game.itemCreator = {
    get app() { return appInstance; },
    open: () => openItemCreator(),
    edit: item => openItemCreator({ item }),
    openScrollFactory: () => openScrollFactory(),
    get scrollFactory() { return scrollFactoryInstance; },
    openSupplier: () => openSupplier(),
    configureSupplier: options => openSupplierConfiguration(options),
    auditSupplier: async ({ profileId = "", level = 20, players = 4, runs = 25 } = {}) => {
      if (!isSupplierEnabled()) throw new Error("Enable Supplier Tools before running an audit.");
      const configuration = getSupplierConfiguration();
      const profile = configuration.profiles.find(entry => entry.id === profileId || entry.name === profileId)
        ?? configuration.profiles[0];
      if (!profile) throw new Error("No Supplier profile is configured.");
      return auditSupplierStock({ profile, level, players, runs });
    },
    closeSupplier: () => closeSupplierWindows(),
    configureSources: () => openSourceSettings(),
    configure: () => openModuleSettings(),
    get supplier() { return supplierInstance; },
    get supplierEnabled() { return isSupplierEnabled(); },
    materialization: MaterializationCore,
    pricing: {
      get: () => getMaterializationSettings(),
      forRarity: rarity => priceForRarity(rarity)
    },
    version: MODULE_VERSION
  };
});

Hooks.once("ready", async () => {
  if (isSupplierEnabled()) await initializeDefaultSources();
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = game.itemCreator;
});

Hooks.on("renderApplicationV2", (app, element) => {
  if (isItemDirectoryApp(app)) injectItemDirectoryButton(app, element);
});

Hooks.on("renderItemDirectory", (app, html) => injectItemDirectoryButton(app, html));
Hooks.on("getItemContextOptions", (_application, options) => addEditContextOption(options));
Hooks.on("getItemDirectoryEntryContext", (_html, options) => addEditContextOption(options));
Hooks.on("getItemDirectoryEntryContextOptions", (_app, options) => addEditContextOption(options));

function contextElement(target) {
  if (target instanceof HTMLElement) return target;
  return target?.[0] instanceof HTMLElement ? target[0] : null;
}

function contextItem(target) {
  const element = contextElement(target);
  const id = element?.dataset?.entryId
    ?? element?.dataset?.documentId
    ?? element?.dataset?.itemId
    ?? target?.data?.("entry-id")
    ?? target?.data?.("document-id")
    ?? target?.data?.("item-id");
  return id ? game.items.get(String(id)) : null;
}

function isEditableWorldItem(item) {
  const supported = item?.type === "weapon"
    || (item?.type === "equipment" && item?.system?.type?.value !== "vehicle")
    || item?.type === "tool";
  return Boolean(game.user.isGM && (item?.documentName ?? item?.constructor?.documentName) === "Item" && supported && !item.parent && !item.pack);
}

function addEditContextOption(options) {
  if (!game.user.isGM || !Array.isArray(options)) return;
  if (options.some(option => option?.itemCreatorEdit)) return;
  options.push({
    itemCreatorEdit: true,
    name: "Edit with Item Creator",
    icon: '<i class="fa-solid fa-hammer"></i>',
    condition: target => isEditableWorldItem(contextItem(target)),
    callback: target => {
      const item = contextItem(target);
      if (isEditableWorldItem(item)) openItemCreator({ item });
    }
  });
}

function openItemCreator({ item = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn("Only a GM can use Item Creator.");
  if (item && !isEditableWorldItem(item)) return ui.notifications.warn("Only world Weapon, Equipment, and Tool Items can be edited with Item Creator.");

  if (appInstance?.element?.isConnected) {
    const sameTarget = (appInstance.editingItemId ?? null) === (item?.id ?? null);
    appInstance.bringToFront?.();
    if (!sameTarget) ui.notifications.warn("Close the current Item Creator draft before opening another Item.");
    return appInstance;
  }

  appInstance = new ItemCreatorApp({ editItem: item });
  appInstance.render({ force: true });
  return appInstance;
}

function openScrollFactory() {
  if (!game.user.isGM) return ui.notifications.warn("Only a GM can use Scroll Factory.");
  if (scrollFactoryInstance?.element?.isConnected) {
    scrollFactoryInstance.bringToFront?.();
    return scrollFactoryInstance;
  }
  scrollFactoryInstance = new ScrollFactoryApp();
  scrollFactoryInstance.render({ force: true });
  return scrollFactoryInstance;
}

function openSupplier() {
  if (!game.user.isGM) return ui.notifications.warn("Only a GM can use Supplier.");
  if (!isSupplierEnabled()) return ui.notifications.warn("Enable Supplier Tools in Item Creator Configuration first.");
  if (supplierInstance?.element?.isConnected) {
    supplierInstance.bringToFront?.();
    return supplierInstance;
  }
  supplierInstance = new SupplierApplication();
  supplierInstance.render({ force: true });
  return supplierInstance;
}

function openSupplierConfiguration({ section = "sources", profileId = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn("Only a GM can configure Supplier.");
  if (!isSupplierEnabled()) return ui.notifications.warn("Enable Supplier Tools and save Item Creator Configuration first.");
  if (supplierConfigInstance?.element?.isConnected) {
    supplierConfigInstance.section = ["sources", "profiles", "progression", "output"].includes(section) ? section : "sources";
    if (profileId) supplierConfigInstance.selectedProfileId = profileId;
    supplierConfigInstance.render({ force: true });
    supplierConfigInstance.bringToFront?.();
    return supplierConfigInstance;
  }
  supplierConfigInstance = new SupplierConfigApplication();
  supplierConfigInstance.section = ["sources", "profiles", "progression", "output"].includes(section) ? section : "sources";
  if (profileId) supplierConfigInstance.selectedProfileId = profileId;
  supplierConfigInstance.render({ force: true });
  return supplierConfigInstance;
}

function openSourceSettings() {
  if (!game.user.isGM) return ui.notifications.warn("Only a GM can configure Item Creator.");
  if (sourceSettingsInstance?.element?.isConnected) {
    sourceSettingsInstance.bringToFront?.();
    return sourceSettingsInstance;
  }
  sourceSettingsInstance = new ItemCreatorSettingsApp();
  sourceSettingsInstance.render({ force: true });
  return sourceSettingsInstance;
}

function openModuleSettings() {
  if (!game.user.isGM) return ui.notifications.warn("Only a GM can configure Item Creator.");
  if (moduleSettingsInstance?.element?.isConnected) {
    moduleSettingsInstance.bringToFront?.();
    return moduleSettingsInstance;
  }
  moduleSettingsInstance = new ItemCreatorModuleSettingsApp();
  moduleSettingsInstance.render({ force: true });
  return moduleSettingsInstance;
}

function closeSupplierWindows() {
  supplierInstance?.close?.();
  supplierConfigInstance?.close?.();
  supplierInstance = null;
  supplierConfigInstance = null;
}

function isItemDirectoryApp(app) {
  const name = String(app?.constructor?.name ?? "");
  const classes = app?.options?.classes ?? [];
  return name.includes("ItemDirectory")
    || name.includes("ItemsDirectory")
    || app?.collection === game.items
    || (classes.includes("directory") && classes.includes("items"));
}

function injectItemDirectoryButton(app, element) {
  if (!game.user.isGM) return;
  const root = element instanceof HTMLElement ? element : element?.[0] ?? app?.element;
  if (!root) return;
  const header = root.querySelector(".directory-header") ?? root.querySelector("header");
  if (!header) return;
  const actions = header.querySelector(".header-actions, .action-buttons") ?? header;

  root.querySelectorAll(".ic-scroll-factory-button, .ic-supplier-directory-button").forEach(button => button.remove());

  if (!root.querySelector(".ic-item-directory-button")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ic-item-directory-button";
    button.dataset.tooltip = "Open Item Creator and Scroll Factory";
    button.innerHTML = '<i class="fa-solid fa-hammer" inert></i><span>Item Creator</span>';
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      openItemCreator();
    });
    actions.append(button);
  }

  if (isSupplierEnabled() && !root.querySelector(".ic-supplier-directory-button")) {
    const supplierButton = document.createElement("button");
    supplierButton.type = "button";
    supplierButton.className = "ic-supplier-directory-button";
    supplierButton.dataset.tooltip = "Generate controlled vendor stock with Supplier";
    supplierButton.innerHTML = '<i class="fa-solid fa-store" inert></i><span>Supplier</span>';
    supplierButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      openSupplier();
    });
    actions.append(supplierButton);
  }
}
