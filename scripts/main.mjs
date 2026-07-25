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
    hint: "Choose which installed content sources Item Creator can use for base weapons and icons, then arrange their priority.",
    icon: "fa-solid fa-books",
    type: ItemCreatorSettingsApp,
    restricted: true
  });

  game.itemCreator = {
    get app() { return appInstance; },
    open: openItemCreator,
    version: MODULE_VERSION
  };
});

Hooks.on("renderApplicationV2", (app, element) => {
  if (isItemDirectoryApp(app)) injectItemDirectoryButton(app, element);
});

Hooks.on("renderItemDirectory", (app, html) => injectItemDirectoryButton(app, html));

function openItemCreator() {
  if (!game.user.isGM) return ui.notifications.warn("Only a GM can use Item Creator.");
  if (appInstance?.element?.isConnected) {
    appInstance.bringToFront?.();
    return appInstance;
  }
  appInstance = new ItemCreatorApp();
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
