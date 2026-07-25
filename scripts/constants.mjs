export const MODULE_ID = "dnd5e-item-creator";
export const MODULE_VERSION = "0.1.2";
export const MODULE_STAGE = "Beta";

export const ITEM_TYPES = Object.freeze([
  { id: "weapon", label: "Weapon", icon: "fa-khanda", available: true },
  { id: "equipment", label: "Equipment", icon: "fa-shield-halved", available: false },
  { id: "consumable", label: "Consumable", icon: "fa-flask", available: false },
  { id: "tool", label: "Tool", icon: "fa-hammer", available: false },
  { id: "container", label: "Container", icon: "fa-box-open", available: false },
  { id: "loot", label: "Loot", icon: "fa-coins", available: false },
  { id: "spell", label: "Spell", icon: "fa-wand-sparkles", available: false },
  { id: "feat", label: "Feature", icon: "fa-star", available: false }
]);

export const STEPS = Object.freeze([
  { id: "itemType", label: "Item Type", icon: "fa-shapes", available: true },
  { id: "baseItem", label: "Base Item", icon: "fa-khanda", available: true },
  { id: "enhancements", label: "Enhancements", icon: "fa-wand-magic-sparkles", available: true },
  { id: "grantedEffects", label: "Granted Effects", icon: "fa-shield-heart", available: true },
  { id: "description", label: "Description", icon: "fa-scroll", available: true },
  { id: "review", label: "Review", icon: "fa-list-check", available: true }
]);

export function defaultSourceSettings() {
  return {
    initialized: false,
    enabledSources: [],
    sourceOrder: []
  };
}
