// The cheapest graded Pokémon cards listed for sale on Solana, from Collector Crypt's marketplace and from Magic Eden.
// Both APIs are public and allow browser requests; prices are what the seller asks, before marketplace fees.

export type SolListing = {
  source: "CC" | "ME";
  mint: string;
  name: string;
  image: string;
  grade: string;
  price: number;
  currency: "SOL" | "USDC";
  url: string;
};

const ME_API = "https://api-mainnet.magiceden.dev/v2";
const CC_API = "https://api.collectorcrypt.com";
/** Magic Eden's symbol for the Collector Crypt collection (tokenized graded cards held in Collector Crypt's vaults). */
const ME_COLLECTION = "collector_crypt";

type MeListing = { price: number; tokenMint: string; token: { name: string; image: string; attributes?: { trait_type: string; value: string }[] } };

/** The `n` cheapest Pokémon listings on Magic Eden, priced in SOL. */
export async function magicEdenCheapest(n = 5): Promise<SolListing[]> {
  const attrs = encodeURIComponent(JSON.stringify([[{ traitType: "Category", value: "Pokemon" }]]));
  const res = await fetch(`${ME_API}/collections/${ME_COLLECTION}/listings?offset=0&limit=20&sort=listPrice&sort_direction=asc&attributes=${attrs}`);
  if (!res.ok) throw new Error(`Magic Eden ${res.status}`);
  const rows = (await res.json()) as MeListing[];
  const seen = new Set<string>();
  return rows
    .filter((r) => r.price > 0 && !seen.has(r.tokenMint) && seen.add(r.tokenMint))
    .slice(0, n)
    .map((r) => {
      const at = Object.fromEntries((r.token.attributes ?? []).map((a) => [a.trait_type, a.value]));
      return {
        source: "ME" as const, mint: r.tokenMint, name: r.token.name, image: r.token.image,
        // GradeNum is missing on some listings; the name always carries it ("… CGC 9 …").
        grade: [at["Grading Company"], at["GradeNum"] ?? r.token.name.match(/\b(?:PSA|CGC|BGS|Beckett|SGC|TAG)\s+([\d.]+)/)?.[1]].filter(Boolean).join(" "),
        price: r.price, currency: "SOL" as const, url: `https://magiceden.io/item-details/${r.tokenMint}`,
      };
    });
}

type CcCard = {
  itemName: string; nftAddress: string; frontImage: string; gradingCompany?: string; grade?: string;
  listing: { price: number; currency: string; marketplace: string } | null;
};

/**
 * The `n` cheapest Pokémon listings on Collector Crypt's own marketplace, priced in USDC. Its API sorts by insured value,
 * not by asking price, so this reads the listed cards in rising price bands and sorts them here.
 */
export async function collectorCryptCheapest(n = 5): Promise<SolListing[]> {
  const found = new Map<string, CcCard>();
  for (const max of [20, 60, 250]) {
    let cursor = "";
    for (let page = 0; page < 3; page++) {
      const q = `step=96&categories=Pokemon&listPriceMin=1&listPriceMax=${max}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await fetch(`${CC_API}/marketplace?${q}`);
      if (!res.ok) throw new Error(`Collector Crypt ${res.status}`);
      const d = (await res.json()) as { filterNFtCard: CcCard[]; nextCursor?: string | null };
      for (const c of d.filterNFtCard ?? []) if (c.listing?.marketplace === "CC" && c.listing.currency === "USDC" && c.listing.price > 0) found.set(c.nftAddress, c);
      if (!d.nextCursor || (d.filterNFtCard ?? []).length < 96) break;
      cursor = d.nextCursor;
    }
    if (found.size >= n) break;
  }
  return [...found.values()]
    .sort((a, b) => a.listing!.price - b.listing!.price)
    .slice(0, n)
    .map((c) => ({
      source: "CC" as const, mint: c.nftAddress, name: c.itemName, image: c.frontImage,
      grade: c.grade ?? c.gradingCompany ?? "", price: c.listing!.price, currency: "USDC" as const,
      url: `https://collectorcrypt.com/assets/solana/${c.nftAddress}`,
    }));
}
