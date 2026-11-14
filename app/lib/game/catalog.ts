import data from "./card-catalog.json";

export type ReferenceCard = { id: number; name: string; src: string; rarity: string; category: string };
export const catalog = data as ReferenceCard[];
/** The limited-time season pack: one tokenized physical White Flare card per pack. The cover is a photo of the booster
 *  the physical cards came from. */
export const SEASON = { name: "White Flare", color: "#8fd3ff", pack: "/cards/wf-token/wf.jpg" } as const;
export const cardById = (id: number): ReferenceCard => catalog.find((card) => card.id === id) ?? catalog[0];
export const decks = [
  { name: "Guardian", subtitle: "Rooted in resilience", color: "#39a979", symbol: "leaf", cards: [15, 2, 1, 3, 13, 17, 30, 44], pack: "/cards/pack-guardian.svg" },
  { name: "Balanced", subtitle: "Find your perfect rhythm", color: "#bb9443", symbol: "spark", cards: [14, 9, 16, 20, 21, 22, 58, 27], pack: "/cards/pack-balanced.svg" },
  { name: "Degen", subtitle: "Fortune favors the bold", color: "#de7359", symbol: "flame", cards: [4, 10, 12, 6, 8, 7, 5, 11], pack: "/cards/pack-degen.svg" },
] as const;
export const starterCards = [...new Set(decks.flatMap((deck) => [...deck.cards]))];
export const COLLECTION_KEY = "cardsdotgg.reference-collection.v1";
export function readCollection(): Record<string, number> {
  const initial = Object.fromEntries(starterCards.map((id) => [id, 1]));
  try {
    const value = JSON.parse(localStorage.getItem(COLLECTION_KEY) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return initial;
    return Object.fromEntries(Object.entries(value).filter(([id, count]) => catalog.some((c) => c.id === +id) && typeof count === "number" && Number.isInteger(count) && count > 0)) as Record<string, number>;
  } catch { return initial; }
}
export function collectCards(ids: number[]) {
  const owned = readCollection();
  ids.forEach((id) => { owned[id] = (owned[id] ?? 0) + 1; });
  localStorage.setItem(COLLECTION_KEY, JSON.stringify(owned));
  window.dispatchEvent(new Event("cardsdotgg:collection"));
}
function pick<T>(items: T[]): T {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return items[Math.floor((random[0] / 4294967296) * items.length)];
}
/** Free, browser-local reference packs. No currency, payment, or onchain mint. */
export function drawPack(): number[] {
  const commons = catalog.filter((c) => c.id >= 43 && c.id <= 69);
  const uncommon = catalog.filter((c) => c.id >= 23 && c.id <= 42);
  const rares = catalog.filter((c) => c.id <= 22);
  return [pick(commons).id, pick(commons).id, pick(uncommon).id, pick(uncommon).id, pick(rares).id];
}
