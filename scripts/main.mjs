import { MODULE_ID, MODULE_VERSION, defaultSourceSettings } from "./constants.mjs";
import { ItemCreatorApp } from "./apps/item-creator-app.mjs";
import { ItemCreatorSettingsApp } from "./apps/settings-app.mjs";
import { ItemCreatorRuntimeEffectService } from "./services/runtime-effect-service.mjs";

let appInstance = null;

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
    version: MODULE_VERSION
  };
});

Hooks.on("renderApplicationV2", (app, element) => {
  if (isItemDirectoryApp(app)) injectItemDirectoryButton(app, element);
});

Hooks.on("renderItemDirectory", (app, html) => injectItemDirectoryButton(app, html));
Hooks.on("getItemContextOptions", (_application, options) => addEditContextOption(options));
// Legacy directory hooks remain registered as harmless compatibility fallbacks.
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
    || (item?.type === "equipment" && item?.system?.type?.value !== "vehicle");
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
  if (item && !isEditableWorldItem(item)) return ui.notifications.warn("Only world Weapon and Equipment Items can be edited with Item Creator.");

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
  if (!root || root.querySelector(".ic-item-directory-button")) return;
  const header = root.querySelector(".directory-header") ?? root.querySelector("header");
  if (!header) return;
  const actions = header.querySelector(".header-actions, .action-buttons") ?? header;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ic-item-directory-button";
  button.dataset.tooltip = "Open assisted custom item creation";
  button.innerHTML = '<i class="fa-solid fa-hammer" inert></i><span>Item Creator</span>';
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openItemCreator();
  });
  actions.append(button);
}
