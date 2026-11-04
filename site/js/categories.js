// The auction house category tree, like the in-game AH (Classic class/subclass ids).
// Class numbers are a best guess until launch; change them here and nowhere else.

export const TREE = [
  { slug: "weapons", label: "Weapons", cls: 2, subs: [
    { slug: "one-handed-axes", label: "One-Handed Axes", sub: [0] },
    { slug: "two-handed-axes", label: "Two-Handed Axes", sub: [1] },
    { slug: "bows", label: "Bows", sub: [2] },
    { slug: "guns", label: "Guns", sub: [3] },
    { slug: "one-handed-maces", label: "One-Handed Maces", sub: [4] },
    { slug: "two-handed-maces", label: "Two-Handed Maces", sub: [5] },
    { slug: "polearms", label: "Polearms", sub: [6] },
    { slug: "one-handed-swords", label: "One-Handed Swords", sub: [7] },
    { slug: "two-handed-swords", label: "Two-Handed Swords", sub: [8] },
    { slug: "staves", label: "Staves", sub: [10] },
    { slug: "fist-weapons", label: "Fist Weapons", sub: [13] },
    { slug: "daggers", label: "Daggers", sub: [15] },
    { slug: "thrown", label: "Thrown", sub: [16] },
    { slug: "crossbows", label: "Crossbows", sub: [18] },
    { slug: "wands", label: "Wands", sub: [19] },
    { slug: "other", label: "Other Weapons", sub: [14, 20] },
  ] },
  { slug: "armor", label: "Armor", cls: 4, subs: [
    { slug: "cloth", label: "Cloth", sub: [1] },
    { slug: "leather", label: "Leather", sub: [2] },
    { slug: "mail", label: "Mail", sub: [3] },
    { slug: "plate", label: "Plate", sub: [4] },
    { slug: "shields", label: "Shields", sub: [6] },
    { slug: "relics", label: "Librams, Idols & Totems", sub: [7, 8, 9] },
    { slug: "misc", label: "Rings, Trinkets & Other", sub: [0] },
  ] },
  { slug: "containers", label: "Containers", cls: 1, subs: [
    { slug: "bags", label: "Bags", sub: [0] },
    { slug: "special", label: "Profession Bags", sub: [1, 2, 3, 4, 5, 6, 7] },
  ] },
  { slug: "consumables", label: "Consumables", cls: 0, subs: [
    { slug: "potions", label: "Potions", sub: [1] },
    { slug: "elixirs", label: "Elixirs", sub: [2] },
    { slug: "flasks", label: "Flasks", sub: [3] },
    { slug: "scrolls", label: "Scrolls", sub: [4] },
    { slug: "food", label: "Food & Drink", sub: [5] },
    { slug: "enhancements", label: "Item Enhancements", sub: [6] },
    { slug: "bandages", label: "Bandages", sub: [7] },
    { slug: "other", label: "Other Consumables", sub: [0, 8] },
  ] },
  { slug: "trade-goods", label: "Trade Goods", cls: 7, open: true, subs: [
    { slug: "cloth", label: "Cloth", sub: [5] },
    { slug: "leather", label: "Leather", sub: [6] },
    { slug: "herbs", label: "Herbs", sub: [9] },
    { slug: "metal-stone", label: "Metal & Stone", sub: [7] },
    { slug: "enchanting", label: "Enchanting", sub: [12] },
    { slug: "elemental", label: "Elemental", sub: [10] },
    { slug: "cooking", label: "Meat & Cooking", sub: [8] },
    { slug: "parts", label: "Parts & Devices", sub: [1, 2, 3] },
    { slug: "other", label: "Other Trade Goods", sub: [0, 4, 11] },
  ] },
  { slug: "projectiles", label: "Projectiles", cls: 6, subs: [
    { slug: "arrows", label: "Arrows", sub: [2] },
    { slug: "bullets", label: "Bullets", sub: [3] },
  ] },
  { slug: "quivers", label: "Quivers", cls: 11, subs: [] },
  { slug: "recipes", label: "Recipes", cls: 9, subs: [
    { slug: "leatherworking", label: "Leatherworking", sub: [1] },
    { slug: "tailoring", label: "Tailoring", sub: [2] },
    { slug: "engineering", label: "Engineering", sub: [3] },
    { slug: "blacksmithing", label: "Blacksmithing", sub: [4] },
    { slug: "cooking", label: "Cooking", sub: [5] },
    { slug: "alchemy", label: "Alchemy", sub: [6] },
    { slug: "first-aid", label: "First Aid", sub: [7] },
    { slug: "enchanting", label: "Enchanting", sub: [8] },
    { slug: "fishing", label: "Fishing", sub: [9] },
    { slug: "other", label: "Books & Other", sub: [0, 10, 11] },
  ] },
  { slug: "reagents", label: "Reagents", cls: 5, subs: [] },
  // catch-all: misc (15) and every class not listed above
  { slug: "misc", label: "Miscellaneous", cls: 15, subs: [
    { slug: "junk", label: "Junk", sub: [0] },
    { slug: "pets", label: "Companions", sub: [2] },
    { slug: "mounts", label: "Mounts", sub: [5] },
    { slug: "other", label: "Other", sub: [1, 3, 4] },
  ] },
];

// Groups shown as cards on the overview and as filter chips, most traded first.
export const FEATURED = [
  "trade-goods/cloth", "trade-goods/herbs", "trade-goods/metal-stone", "trade-goods/leather",
  "trade-goods/enchanting", "trade-goods/elemental", "trade-goods/cooking",
  "consumables", "containers", "recipes", "weapons", "armor", "misc",
];

const byClass = new Map(TREE.map((t) => [t.cls, t]));
const misc = TREE.find((t) => t.slug === "misc");

export function classify(cls, sub) {
  if (cls == null) return null;
  const top = byClass.get(cls) || misc;
  const child = top.subs.find((s) => s.sub.includes(sub)) || null;
  return { top, sub: top === misc && !byClass.has(cls) ? misc.subs.find((s) => s.slug === "other") : child };
}

export function findNode(path) {
  const [a, b] = String(path || "").split("/");
  const top = TREE.find((t) => t.slug === a);
  if (!top) return null;
  if (!b) return { top, sub: null, path: top.slug, label: top.label };
  const sub = top.subs.find((s) => s.slug === b);
  return sub ? { top, sub, path: `${top.slug}/${sub.slug}`, label: sub.label } : null;
}

export function inNode(cat, node) {
  if (!cat || !node) return false;
  return cat.top === node.top && (!node.sub || cat.sub === node.sub);
}

export function catPath(cat) {
  if (!cat) return null;
  return cat.sub ? `${cat.top.slug}/${cat.sub.slug}` : cat.top.slug;
}

export function catLabel(cat) {
  if (!cat) return null;
  return cat.sub ? cat.sub.label : cat.top.label;
}
