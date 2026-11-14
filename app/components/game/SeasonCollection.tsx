"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Send, Sparkles } from "lucide-react";
import { readable } from "@/components/TxButton";
import HoloCard from "./HoloCard";
import type { TheaterCard } from "./CardTheater";
import { A } from "@/lib/contracts";
import { ONE_YOCTO, TGAS } from "@/lib/near";
import { useView } from "@/lib/useView";
import { useWallet } from "@/lib/wallet";
import { SEASON } from "@/lib/game/catalog";
import { rwaCards, type RwaCard, type RwaStockJson, type RwaTokenJson } from "@/lib/game/rwa";
import type { SeasonJson } from "@/lib/game/useCollection";

/** Every season token (minted or still in packs), the stock and the season window, for the collection's season tab. */
export function useSeasonCollection() {
  const { accountId } = useWallet();
  const all = useView<RwaTokenJson[]>(A.game, "rwa_all", {}, { enabled: !!A.game, interval: 30000 });
  const stock = useView<RwaStockJson>(A.game, "rwa_stock", {}, { enabled: !!A.game, interval: 30000 });
  const season = useView<SeasonJson>(A.game, "get_season", {}, { enabled: !!A.game, interval: 60000 }).data;
  const byId = new Map((all.data ?? []).map((t) => [t.id, t]));
  const mine = (all.data ?? []).filter((t) => !!accountId && t.owner === accountId);
  return { accountId, byId, mine, stock: stock.data, season, refetch: () => { all.refetch(); stock.refetch(); } };
}
export type SeasonData = ReturnType<typeof useSeasonCollection>;

/** The photo of a physical card as the card theater shows it. */
export const theaterCard = (c: RwaCard, t?: RwaTokenJson): TheaterCard => ({ src: c.src, name: c.name, rarity: `${c.set} ${String(c.number).padStart(3, "0")} · token #${c.id}${t?.redeemed ? " · redeemed" : ""}` });

/** Season stats, in the same cream panel as the base collection's stats. */
export function SeasonStats({ data }: { data: SeasonData }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 60000); return () => clearInterval(t); }, []);
  const days = data.season ? Math.max(0, Math.ceil((data.season.end - now) / 86400)) : 0;
  const ended = !!data.season && now >= data.season.end;
  return <div className="collection-stats">
    <div><b>{data.mine.length}<small>/ {data.stock?.total ?? rwaCards.length}</small></b><span>CARDS COLLECTED</span></div>
    <div><b>{data.stock?.remaining ?? "–"}</b><span>LEFT IN PACKS</span></div>
    <div><b>{SEASON.name}</b><span>{!data.season ? "SEASON" : ended ? "SEASON ENDED" : `SEASON · ${days} DAYS LEFT`}</span></div>
    <p>Real {SEASON.name} cards held in the vault. Each one exists once and is tokenized on NEAR.<br />Keep yours, or send it to another player.</p>
  </div>;
}

/** The 23 physical cards in the collection grid style: yours, pulled by someone else, still in packs, or redeemed. */
export function SeasonGrid({ data, query, onlyOwned, onOnlyOwned, onInspect }: { data: SeasonData; query: string; onlyOwned: boolean; onOnlyOwned: (v: boolean) => void; onInspect: (c: RwaCard) => void }) {
  const { call } = useWallet();
  const [busy, setBusy] = useState<number | null>(null), [msg, setMsg] = useState("");
  const list = rwaCards.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()) && (!onlyOwned || data.byId.get(c.id)?.owner === data.accountId && !!data.accountId));

  async function run(id: number, methodName: string, args: object, done: string, deposit?: typeof ONE_YOCTO) {
    setBusy(id); setMsg("");
    try {
      const r = await call({ receiverId: A.game!, methodName, args, gas: TGAS(30), ...(deposit ? { deposit } : {}) });
      if (r.failure) throw new Error(r.failure);
      setMsg(done); data.refetch();
    } catch (e) { setMsg(readable((e as Error)?.message ?? String(e))); }
    setBusy(null);
  }
  const send = (c: RwaCard) => { const to = window.prompt(`Send ${c.name} to which NEAR account?`)?.trim(); if (to) run(c.id, "nft_transfer", { token_id: String(c.id), receiver_id: to }, `${c.name} was sent to ${to}.`, ONE_YOCTO); };

  return <>
    <div className="collection-subbar"><span>{list.length} cards</span><label><input type="checkbox" checked={onlyOwned} onChange={(e) => onOnlyOwned(e.target.checked)} />Collected only</label></div>
    {msg && <p className="season-msg" role="status">{msg}</p>}
    <div className="collection-grid">{list.map((c) => {
      const t = data.byId.get(c.id), yours = !!data.accountId && t?.owner === data.accountId;
      const badge = t?.redeemed ? <span className="uncollected">Redeemed</span>
        : yours ? <span className="owned-count">Yours</span>
        : t?.owner ? <span className="uncollected">Pulled</span>
        : <span className="uncollected trial">In packs</span>;
      return <div key={c.id} className="season-cell">
        <button className={`collection-card holo ${yours ? "owned" : "unowned"}`} onClick={() => onInspect(c)}>
          <div className="collection-image"><HoloCard rarity="Holo Rare"><img src={c.src} alt={c.name} loading="lazy" /></HoloCard>{badge}</div>
          <div><b>{c.name}</b><span>{String(c.number).padStart(3, "0")}</span></div>
          <small><Sparkles size={10} /> {c.set} · token #{c.id}</small>
        </button>
        {yours && !t?.redeemed && <div className="season-actions">
          <button disabled={busy !== null} onClick={() => send(c)}><Send size={13} />Send</button>
        </div>}
      </div>;
    })}</div>
    {!list.length && <div className="empty-collection"><Sparkles size={26} /><h2>{onlyOwned ? "No season cards yet." : "No cards found."}</h2><p>{onlyOwned ? "Every season pack holds one real card." : "Try another name."}</p><Link className="subtle-button" href="/packs">Open a season pack</Link></div>}
  </>;
}
