"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {ArrowUpRight,Layers,Search,Sparkles} from "lucide-react";
import {catalog,decks as tierDecks} from "@/lib/game/catalog";
import {STARTER_PICS,hpBonus,useCollection} from "@/lib/game/useCollection";
import HoloCard from "./HoloCard";
import {SeasonGrid,SeasonStats,theaterCard,useSeasonCollection} from "./SeasonCollection";
import type {TheaterCard} from "./CardTheater";
import {SEASON} from "@/lib/game/catalog";
import {useDecks} from "@/lib/useDecks";
const CardTheater=dynamic(()=>import("./CardTheater"),{ssr:false});
export default function Collection(){
  const [query,setQuery]=useState(""),[filter,setFilter]=useState("All cards"),[onlyOwned,setOnlyOwned]=useState(false),[inspect,setInspect]=useState<number[]|null>(null),[inspectCard,setInspectCard]=useState<TheaterCard|null>(null);
  const season=useSeasonCollection(),isSeason=filter===SEASON.name;
  const col=useCollection();
  const {decks:chainDecks}=useDecks();
  const onchain=new Set<number>(chainDecks.filter(d=>!d.retired).flatMap(d=>[...(tierDecks[d.tier]?.cards??[])]));
  // Yours for real: starter pictures of a deck you hold, plus pictures unlocked from packs. Other starter pictures are trial only.
  const has=(id:number)=>onchain.has(id)||col.pictures.has(id);
  const trial=(id:number)=>!has(id)&&STARTER_PICS.has(id);
  const filtered=catalog.filter(c=>(!onlyOwned||has(c.id))&&c.name.toLowerCase().includes(query.toLowerCase())&&(filter==="All cards"||filter==="Holo rares"&&c.rarity==="Holo Rare"||filter==="Pokémon"&&c.category==="Pokemon"||filter==="Trainers"&&c.category==="Trainer"||filter==="Energy"&&c.category==="Energy"));
  return <div className="collection-page"><section className="arena-heading"><div><span className="eyebrow"><Layers size={13}/>YOUR COLLECTION</span><h1>Little cards. <span>Big stories.</span></h1><p>The classics you love, and the discoveries still to come.</p></div><Link className="primary-button" href="/packs">Discover a new pack<ArrowUpRight size={17}/></Link></section>{isSeason?<SeasonStats data={season}/>:<div className="collection-stats"><div><b>{catalog.filter(c=>has(c.id)).length}<small>/ {catalog.length}</small></b><span>CARDS COLLECTED</span></div><div><b>{catalog.filter(c=>c.rarity==="Holo Rare"&&has(c.id)).length}</b><span>HOLO RARES</span></div><div><b>Base Set</b><span>THE ORIGINAL COLLECTION</span></div><p>These are trial cards: starter cards come with your trial decks and trial pack pulls are saved on NEAR.<br/>The real card set is coming soon. Cards marked Trial are only for practice until you own a deck of their type.</p></div>}<div className="collection-toolbar"><div className="collection-tabs">{["All cards",SEASON.name,"Holo rares","Pokémon","Trainers","Energy"].map(f=><button key={f} className={`${filter===f?"selected":""} ${f===SEASON.name?"season-tab":""}`} onClick={()=>setFilter(f)}>{f}{f===SEASON.name&&<i>SEASON</i>}</button>)}</div><label className="card-search"><Search size={16}/><input placeholder="Find a card…" aria-label="Search cards" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>{isSeason?<SeasonGrid data={season} query={query} onlyOwned={onlyOwned} onOnlyOwned={setOnlyOwned} onInspect={c=>setInspectCard(theaterCard(c,season.byId.get(c.id)))}/>:<><div className="collection-subbar"><span>{filtered.length} cards</span><label><input type="checkbox" checked={onlyOwned} onChange={e=>setOnlyOwned(e.target.checked)}/>Collected only</label></div><div className="collection-grid">{filtered.map(card=><button className={`collection-card ${has(card.id)?"owned":"unowned"} ${card.rarity==="Holo Rare"?"holo":""}`} key={card.id} onClick={()=>setInspect([card.id])}><div className="collection-image"><HoloCard rarity={card.rarity}><img src={card.src} alt={card.name} loading="lazy"/></HoloCard>{onchain.has(card.id)?<span className="owned-count">Trial deck</span>:col.pictures.has(card.id)?<span className="owned-count">Trial pack{hpBonus(card.id)>0?` · +${hpBonus(card.id)}% HP`:""}</span>:trial(card.id)?<span className="uncollected trial">Trial</span>:<span className="uncollected">Locked</span>}</div><div><b>{card.name}</b><span>{String(card.id).padStart(3,"0")}</span></div><small>{card.rarity==="Holo Rare"&&<Sparkles size={10}/>} {card.rarity}</small></button>)}</div>{!filtered.length&&<div className="empty-collection"><Search size={26}/><h2>No cards found.</h2><p>Try another name or change your filters.</p><button className="subtle-button" onClick={()=>{setQuery("");setFilter("All cards");setOnlyOwned(false);}}>Show all cards</button></div>}</>}{inspect&&<CardTheater ids={inspect} title="The original collection" inspection onDone={()=>setInspect(null)}/>}{inspectCard&&<CardTheater ids={[0]} cards={[inspectCard]} title={`${SEASON.name} season`} inspection onDone={()=>setInspectCard(null)}/>}</div>;
}
