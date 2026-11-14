"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {ArrowRight,ChevronLeft,ChevronRight,Gift,Layers,RotateCcw,Scissors,Sparkles,Volume2,VolumeX} from "lucide-react";
import {SEASON,cardById,catalog,decks} from "@/lib/game/catalog";
import CreatureCard from "./CreatureCard";
import {readable} from "@/components/TxButton";
import {A} from "@/lib/contracts";
import {fresh,creature} from "@/lib/game/duel";
import {STARTER_PICS,hpBonus,rarityName,useCollection} from "@/lib/game/useCollection";
import {ONE_YOCTO,TGAS,view} from "@/lib/near";
import {useWallet} from "@/lib/wallet";
import type {CollectionJson,SeasonJson} from "@/lib/game/useCollection";
import {useView} from "@/lib/useView";
import {rwaCard,useRwaStock,type RwaTokenJson} from "@/lib/game/rwa";
import {enableSound,sound} from "@/lib/game/sound";
const PackScene=dynamic(()=>import("./PackScene"),{ssr:false});
/** The season pack sits after the three deck packs. */
const SEASON_TAB=decks.length;
/** "59d 23h", "4h 12m", "38s": the two largest units left. */
function left(s:number){s=Math.max(0,Math.floor(s));const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return d?`${d}d ${h}h`:h?`${h}h ${m}m`:m?`${m}m ${s%60}s`:`${s}s`;}
const CardTheater=dynamic(()=>import("./CardTheater"),{ssr:false});
export default function PackRoom(){
  const [tier,setTier]=useState(0),[selected,setSelected]=useState(0),[phase,setPhase]=useState<"choose"|"sealed"|"opening"|"reveal"|"summary">("choose"),[pulled,setPulled]=useState<number[]>([]),[fresh_,setFresh]=useState<number[]>([]),[newCreature,setNewCreature]=useState<number|null>(null),[err,setErr]=useState(""),[inspect,setInspect]=useState<number[]|null>(null),[audio,setAudio]=useState(false),[saveError,setSaveError]=useState(false);
  const {call,accountId}=useWallet();const col=useCollection();
  // The season window comes from the contract, which also refuses a season pack outside it; the clock here only drives the countdown.
  const season=useView<SeasonJson>(A.game,"get_season",{},{enabled:!!A.game,interval:60000}).data;
  const [clock,setClock]=useState(()=>Date.now()/1000);
  useEffect(()=>{const t=setInterval(()=>setClock(Date.now()/1000),1000);return()=>clearInterval(t);},[]);
  const isSeason=tier===SEASON_TAB;
  const seasonState:"none"|"soon"|"live"|"ended"=!season?"none":clock<season.start?"soon":clock<season.end?"live":"ended";
  // The season pack also hands out one tokenized physical card, so it sells out with the stock.
  const stock=useRwaStock();const left_=stock.data?.remaining??0,total=stock.data?.total??0;
  const soldOut=!!stock.data&&left_===0;
  const blocked=isSeason&&(seasonState!=="live"||soldOut);
  const [physical,setPhysical]=useState<RwaTokenJson|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>>(),opening=useRef(false),saved=useRef(false),swipe=useRef(0);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  /** Buy a pack (2 tUSD to the game contract), wait for the chain to record it, then show what came out. */
  async function open(){
    if(opening.current||phase!=="sealed"||!accountId||blocked)return;
    opening.current=true;setErr("");setPhase("opening");sound("pack");
    const t0=Date.now(),hadPics=new Set([...STARTER_PICS,...col.pictures]),hadCreatures=new Set(col.creatures),before=col.opened;
    try{
      const myTokens=()=>view<RwaTokenJson[]>(A.game,"rwa_tokens_of",{account_id:accountId});
      const hadTokens=isSeason?new Set((await myTokens()).map(t=>t.id)):new Set<number>();
      // Trial packs are free (only gas); the season pack costs 2 tUSD because it holds a real physical card.
      const r=await call(isSeason?{receiverId:A.tusd,methodName:"ft_transfer_call",args:{receiver_id:A.game,amount:"2000000",msg:JSON.stringify({action:"season_pack"})},deposit:ONE_YOCTO,gas:TGAS(60)}:{receiverId:A.game,methodName:"open_pack",args:{},gas:TGAS(30)});
      if(r.failure)throw new Error(r.failure);
      if(isSeason){
        // A season pack holds one physical card and nothing else: wait for the new token to show up.
        let got:RwaTokenJson|undefined;
        for(let i=0;i<14&&!got;i++){got=(await myTokens()).find(t=>!hadTokens.has(t.id));if(!got)await new Promise(res=>setTimeout(res,900));}
        if(!got)throw new Error("Your card has not shown up yet. Check your collection in a moment.");
        setPhysical(got);stock.refetch();
        timer.current=setTimeout(()=>{setPhase("reveal");sound("rare");},Math.max(0,1450-(Date.now()-t0)));
        return;
      }
      let c:CollectionJson|undefined;
      for(let i=0;i<14;i++){c=await view<CollectionJson>(A.game,"get_collection",{account_id:accountId});if(c.opened>before)break;await new Promise(res=>setTimeout(res,900));}
      if(!c||c.opened<=before||!c.last_pack)throw new Error("Your pack has not shown up yet. Check again in a moment.");
      setPulled(c.last_pack.pictures);setFresh([...new Set(c.last_pack.pictures)].filter(id=>!hadPics.has(id)));
      setNewCreature(hadCreatures.has(c.last_pack.creature)?null:c.last_pack.creature);
      col.refetch();
      timer.current=setTimeout(()=>{setPhase("reveal");sound("rare");},Math.max(0,1450-(Date.now()-t0)));
    }catch(e){
      opening.current=false;setErr(readable((e as Error)?.message??String(e)));setPhase("sealed");
    }
  }
  function collect(){setPhase("summary");col.refetch();}
  function reset(){clearTimeout(timer.current);opening.current=false;saved.current=false;setPhysical(null);setPulled([]);setFresh([]);setNewCreature(null);setErr("");setPhase("choose");}
  return <div className={`pack-room pack-phase-${phase}`}>
    <div className="pack-room-top"><div className="arena-heading-actions"><span className="local-badge"><Gift size={13}/>{isSeason?"2 tUSD per pack":"Free trial packs"}</span><button className="round-button" aria-label={audio?"Mute sound":"Enable sound"} onClick={()=>{setAudio(!audio);enableSound(!audio);}}>{audio?<Volume2 size={17}/>:<VolumeX size={17}/>}</button></div></div>
    {phase!=="summary"&&phase!=="reveal"&&<><div className="pack-title"><span className="eyebrow"><Sparkles size={13}/>THE PACK ROOM</span><h1>{phase==="sealed"?"A little anticipation.":phase==="opening"?"Here comes the magic.":"What’s waiting inside?"}</h1><p>{phase==="sealed"?"Swipe across the seal, or tap Open.":"Pick a pack, then break the seal."}</p></div>
      <div className="pack-type-tabs">{decks.map((d,i)=><button key={d.name} className={i===tier?"selected":""} disabled={phase!=="choose"} onClick={()=>{setTier(i);sound("flip");}}><span style={{background:d.color}}/>{d.name}</button>)}<button className={`season-tab ${isSeason?"selected":""}`} disabled={phase!=="choose"} onClick={()=>{setTier(SEASON_TAB);sound("flip");}}><span style={{background:SEASON.color}}/>{season?.name??SEASON.name}<i>SEASON</i></button></div>
      {isSeason&&<div className={`season-banner ${seasonState}`} role="status">{seasonState==="live"&&soldOut?<><b>Sold out</b> · all {total} physical cards have been pulled</>:seasonState==="live"?<><b>Season live</b> · {left_}/{total} physical cards left · ends in {left(season!.end-clock)}</>:seasonState==="soon"?<><b>Opens in</b> {left(season!.start-clock)}</>:seasonState==="ended"?<><b>Season ended</b> · its cards stay in your collection</>:<><b>No season right now</b></>}</div>}
      <div className="pack-stage"><div className="pack-halo"/><PackScene tier={tier} phase={phase==="choose"?"choose":phase==="sealed"?"sealed":"opening"} selected={selected} onSelect={(id)=>{setSelected(id);sound("flip");}}/>
        {phase==="sealed"&&<div className="rip-guide" onPointerDown={e=>{swipe.current=e.clientX;e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e=>{if(Math.abs(e.clientX-swipe.current)>55)open();}}><span/><Scissors size={21}/><span/><small>SWIPE TO OPEN</small></div>}
        {phase==="opening"&&<div className="pack-open-flash"/>}
      </div>
      <div className="pack-actions">{phase==="choose"?<><div className="pack-picker"><button className="round-button" aria-label="Previous pack" onClick={()=>setSelected((selected+9)%10)}><ChevronLeft size={19}/></button><span>PACK <b>{String(selected+1).padStart(2,"0")}</b><i>/ 10</i></span><button className="round-button" aria-label="Next pack" onClick={()=>setSelected((selected+1)%10)}><ChevronRight size={19}/></button></div><button className="primary-button" disabled={blocked} onClick={()=>{setPhase("sealed");sound("flip");}}>{blocked?(soldOut&&seasonState==="live"?"Sold out":"Season pack closed"):"This one feels lucky"}<ArrowRight size={17}/></button><small>Drag or use the arrows to browse · 5 cards in every pack</small></>:phase==="sealed"?<><button className="primary-button" disabled={!accountId||blocked} onClick={open}><Scissors size={17}/>{isSeason?"Open season pack":"Open this pack"} · {isSeason?"2 tUSD":"Free"}</button>{err&&<small className="pack-err" role="alert">{err}{isSeason&&<> <Link href="/deposit">Get free coins</Link></>}</small>}<button className="text-button" onClick={()=>setPhase("choose")}>Choose a different pack</button></>:<span className="opening-copy">A new chapter is unfolding…</span>}</div>
      <p className="pack-disclaimer">{isSeason?`Season pack: 1 real ${SEASON.name} card, tokenized as a one-of-one you can keep or send to another player. ${total||23} cards, each exists once; every card left has the same chance: 1 in ${left_||"–"}.`:"Free for every wallet: 5 trial pictures and 1 creature per pack. Rare pictures add max HP in battle. The real card set is coming soon."}</p>
    </>}
    {phase==="reveal"&&(physical&&rwaCard(physical.id)?<CardTheater ids={[physical.id]} cards={[{src:rwaCard(physical.id)!.src,name:rwaCard(physical.id)!.name,rarity:`${physical.card} · token #${physical.id}`}]} title="Your White Flare card" pack onDone={collect}/>:<CardTheater ids={pulled} title="Your new discoveries" pack onDone={collect}/>)}
    {phase==="summary"&&physical&&rwaCard(physical.id)&&<section className="pack-summary"><div className="summary-mark"><Sparkles size={28}/></div><span className="eyebrow">ONE REAL CARD, TOKENIZED</span><h1>{rwaCard(physical.id)!.name} is yours.</h1><div className="rwa-pull"><img src={rwaCard(physical.id)!.src} alt={rwaCard(physical.id)!.name}/><div><span className="new-badge inline">PHYSICAL CARD</span><b>{rwaCard(physical.id)!.name}</b><small>{physical.card} · token #{physical.id} · one of one. Keep it, or send it to another player from your collection.</small></div></div><div className="summary-actions"><button className="primary-button" onClick={reset}><RotateCcw size={16}/>Open another pack</button><Link className="subtle-button" href="/collection"><Layers size={16}/>See my physical cards<ArrowRight size={16}/></Link></div></section>}
    {phase==="summary"&&!physical&&<section className="pack-summary"><div className="summary-mark"><Sparkles size={28}/></div><span className="eyebrow">{fresh_.length?`${fresh_.length} NEW TRIAL ${fresh_.length===1?"PICTURE":"PICTURES"} UNLOCKED`:"NOTHING NEW THIS TIME"}</span><h1>A lovely little haul.</h1><p>{fresh_.length||newCreature!==null?"Use them in the deck builder.":"You already had all of these. Try another pack."}</p><div className="unlock-meter" role="img" aria-label={`${col.usable.size} of ${catalog.length} pictures unlocked`}><i style={{width:`${Math.min(100,col.usable.size/catalog.length*100)}%`}}/><b>{col.usable.size} / {catalog.length} pictures</b></div>{newCreature!==null&&<div className="new-creature"><CreatureCard size="md" bare card={fresh(newCreature)}/><div><span className="new-badge inline">NEW CREATURE</span><b>{creature(newCreature).name}</b><small>{creature(newCreature).ability}. Add it to a deck in the builder.</small></div></div>}<div className="pack-results">{pulled.map((id,i)=>{const card=cardById(id);return <button className={`result-card ${card.rarity==="Holo Rare"?"holo":""}`} key={i} style={{animationDelay:`${i*130}ms`}} onClick={()=>setInspect([id])}>{fresh_.includes(id)&&<span className="new-badge">NEW</span>}<span className="trial-tag result-trial">Trial</span><img src={card.src} alt={card.name}/><b>{card.name}</b><small>{rarityName(id)}{fresh_.includes(id)&&hpBonus(id)>0?` · +${hpBonus(id)}% HP`:""}</small></button>;})}</div><div className="summary-actions"><button className="primary-button" onClick={reset}><RotateCcw size={16}/>Open another pack</button><Link className="subtle-button" href="/collection"><Layers size={16}/>View collection<ArrowRight size={16}/></Link><Link className="subtle-button" href="/decks"><Layers size={16}/>Use in my deck<ArrowRight size={16}/></Link></div></section>}
    {inspect&&<CardTheater ids={inspect} title="Your discovery" inspection onDone={()=>setInspect(null)}/>}
  </div>;
}
