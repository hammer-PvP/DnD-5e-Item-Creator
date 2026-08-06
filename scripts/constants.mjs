export const MODULE_ID = "dnd5e-item-creator";
export const MODULE_VERSION = "0.5.0g";
export const MODULE_STAGE = "Beta Candidate";

export const ITEM_TYPES = Object.freeze([
  { id: "weapon", label: "Weapon", icon: "fa-khanda", available: true },
  { id: "equipment", label: "Equipment", icon: "fa-shield-halved", available: true },
  { id: "tool", label: "Tool", icon: "fa-hammer", available: true },
  { id: "scrollFactory", label: "Scroll Factory", icon: "fa-scroll", available: true }
]);

export const STEPS = Object.freeze([
  { id: "itemType", label: "Item Type", icon: "fa-shapes", available: true },
  { id: "baseItem", label: "Base Item", icon: "fa-box-open", available: true },
  { id: "enhancements", label: "Enhancements", icon: "fa-wand-magic-sparkles", available: true },
  { id: "grantedEffects", label: "Granted Effects", icon: "fa-shield-heart", available: true },
  { id: "spellsResources", label: "Spells & Resources", icon: "fa-sparkles", available: true },
  { id: "description", label: "Description", icon: "fa-scroll", available: true },
  { id: "review", label: "Review", icon: "fa-list-check", available: true }
]);

export const EQUIPMENT_FORMS = Object.freeze([
  { id: "armor", label: "Armor", nativeType: "light", icon: "fa-shield" },
  { id: "shield", label: "Shield", nativeType: "shield", icon: "fa-shield-halved" },
  { id: "torso", label: "Torso / Robe", nativeType: "clothing", icon: "fa-shirt" },
  { id: "cloak", label: "Cloak / Mantle", nativeType: "clothing", icon: "fa-user-ninja" },
  { id: "headwear", label: "Headwear", nativeType: "clothing", icon: "fa-hat-wizard" },
  { id: "neck", label: "Neck / Amulet", nativeType: "wondrous", icon: "fa-gem" },
  { id: "hands", label: "Hands / Gloves", nativeType: "clothing", icon: "fa-mitten" },
  { id: "ring", label: "Finger / Ring", nativeType: "ring", icon: "fa-ring" },
  { id: "feet", label: "Feet / Boots", nativeType: "clothing", icon: "fa-shoe-prints" },
  { id: "waist", label: "Waist / Belt", nativeType: "clothing", icon: "fa-link" },
  { id: "focus", label: "Focus / Catalyst", nativeType: "wondrous", icon: "fa-wand-magic-sparkles" },
  { id: "accessory", label: "Accessory", nativeType: "wondrous", icon: "fa-star" },
  { id: "other", label: "Other Equipment", nativeType: "trinket", icon: "fa-cube" }
]);

export function defaultSourceSettings() {
  return {
    initialized: false,
    enabledSources: [],
    sourceOrder: []
  };
}
