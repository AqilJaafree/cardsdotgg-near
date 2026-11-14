"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {ArrowRight,ChevronLeft,ChevronRight,Gift,Layers,RotateCcw,Scissors,Sparkles,Volume2,VolumeX} from "lucide-react";
import {cardById,catalog,decks} from "@/lib/game/catalog";
import CreatureCard from "./CreatureCard";
import {readable} from "@/components/TxButton";
import {A} from "@/lib/contracts";
import {fresh,creature} from "@/lib/game/duel";
import {STARTER_PICS,hpBonus,rarityName,useCollection} from "@/lib/game/useCollection";
import {ONE_YOCTO,TGAS,view} from "@/lib/near";
import {useWallet} from "@/lib/wallet";
import type {CollectionJson} from "@/lib/game/useCollection";
import {enableSound,sound} from "@/lib/game/sound";
const PackScene=dynamic(()=>import("./PackScene"),{ssr:false});
const CardTheater=dynamic(()=>import("./CardTheater"),{ssr:false});
export default function PackRoom(){
  const [tier,setTier]=useState(0),[selected,setSelected]=useState(0),[phase,setPhase]=useState<"choose"|"sealed"|"opening"|"reveal"|"summary">("choose"),[pulled,setPulled]=useState<number[]>([]),[fresh_,setFresh]=useState<number[]>([]),[newCreature,setNewCreature]=useState<number|null>(null),[err,setErr]=useState(""),[inspect,setInspect]=useState<number[]|null>(null),[audio,setAudio]=useState(false),[saveError,setSaveError]=useState(false);
  const {call,accountId}=useWallet();const col=useCollection();
  const timer=useRef<ReturnType<typeof setTimeout>>(),opening=useRef(false),saved=useRef(false),swipe=useRef(0);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  /** Buy a pack (2 tUSD to the game contract), wait for the chain to record it, then show what came out. */
  async function open(){
    if(opening.current||phase!=="sealed"||!accountId)return;
    opening.current=true;setErr("");setPhase("opening");sound("pack");
    const t0=Date.now(),hadPics=new Set([...STARTER_PICS,...col.pictures]),hadCreatures=new Set(col.creatures),before=col.opened;
    try{
      const r=await call({receiverId:A.tusd,methodName:"ft_transfer_call",args:{receiver_id:A.game,amount:"2000000",msg:JSON.stringify({action:"pack"})},deposit:ONE_YOCTO,gas:TGAS(60)});
      if(r.failure)throw new Error(r.failure);
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
  function reset(){clearTimeout(timer.current);opening.current=false;saved.current=false;setPulled([]);setFresh([]);setNewCreature(null);setErr("");setPhase("choose");}
  return <div className={`pack-room pack-phase-${phase}`}>
    <div className="pack-room-top"><div className="arena-heading-actions"><span className="local-badge"><Gift size={13}/>2 tUSD per pack</span><button className="round-button" aria-label={audio?"Mute sound":"Enable sound"} onClick={()=>{setAudio(!audio);enableSound(!audio);}}>{audio?<Volume2 size={17}/>:<VolumeX size={17}/>}</button></div></div>
    {phase!=="summary"&&phase!=="reveal"&&<><div className="pack-title"><span className="eyebrow"><Sparkles size={13}/>THE PACK ROOM</span><h1>{phase==="sealed"?"A little anticipation.":phase==="opening"?"Here comes the magic.":"What’s waiting inside?"}</h1><p>{phase==="sealed"?"Swipe across the seal, or tap Open.":"Pick a pack, then break the seal."}</p></div>
      <div className="pack-type-tabs">{decks.map((d,i)=><button key={d.name} className={i===tier?"selected":""} disabled={phase!=="choose"} onClick={()=>{setTier(i);sound("flip");}}><span style={{background:d.color}}/>{d.name}</button>)}</div>
      <div className="pack-stage"><div className="pack-halo"/><PackScene tier={tier} phase={phase==="choose"?"choose":phase==="sealed"?"sealed":"opening"} selected={selected} onSelect={(id)=>{setSelected(id);sound("flip");}}/>
        {phase==="sealed"&&<div className="rip-guide" onPointerDown={e=>{swipe.current=e.clientX;e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e=>{if(Math.abs(e.clientX-swipe.current)>55)open();}}><span/><Scissors size={21}/><span/><small>SWIPE TO OPEN</small></div>}
        {phase==="opening"&&<div className="pack-open-flash"/>}
      </div>
      <div className="pack-actions">{phase==="choose"?<><div className="pack-picker"><button className="round-button" aria-label="Previous pack" onClick={()=>setSelected((selected+9)%10)}><ChevronLeft size={19}/></button><span>PACK <b>{String(selected+1).padStart(2,"0")}</b><i>/ 10</i></span><button className="round-button" aria-label="Next pack" onClick={()=>setSelected((selected+1)%10)}><ChevronRight size={19}/></button></div><button className="primary-button" onClick={()=>{setPhase("sealed");sound("flip");}}>This one feels lucky<ArrowRight size={17}/></button><small>Drag or use the arrows to browse · 5 cards in every pack</small></>:phase==="sealed"?<><button className="primary-button" disabled={!accountId} onClick={open}><Scissors size={17}/>Open this pack · 2 tUSD</button>{err&&<small className="pack-err" role="alert">{err} <Link href="/deposit">Get free coins</Link></small>}<button className="text-button" onClick={()=>setPhase("choose")}>Choose a different pack</button></>:<span className="opening-copy">A new chapter is unfolding…</span>}</div>
      <p className="pack-disclaimer">Each pack: 5 pictures and 1 creature. Rare pictures add max HP in battle.</p>
    </>}
    {phase==="reveal"&&<CardTheater ids={pulled} title="Your new discoveries" pack onDone={collect}/>}
    {phase==="summary"&&<section className="pack-summary"><div className="summary-mark"><Sparkles size={28}/></div><span className="eyebrow">{fresh_.length?`${fresh_.length} NEW ${fresh_.length===1?"PICTURE":"PICTURES"} UNLOCKED`:"NOTHING NEW THIS TIME"}</span><h1>A lovely little haul.</h1><p>{fresh_.length||newCreature!==null?"Use them in the deck builder.":"You already had all of these. Try another pack."}</p><div className="unlock-meter" role="img" aria-label={`${col.usable.size} of ${catalog.length} pictures unlocked`}><i style={{width:`${Math.min(100,col.usable.size/catalog.length*100)}%`}}/><b>{col.usable.size} / {catalog.length} pictures</b></div>{newCreature!==null&&<div className="new-creature"><CreatureCard size="md" bare card={fresh(newCreature)}/><div><span className="new-badge inline">NEW CREATURE</span><b>{creature(newCreature).name}</b><small>{creature(newCreature).ability}. Add it to a deck in the builder.</small></div></div>}<div className="pack-results">{pulled.map((id,i)=>{const card=cardById(id);return <button className={`result-card ${card.rarity==="Holo Rare"?"holo":""}`} key={i} style={{animationDelay:`${i*130}ms`}} onClick={()=>setInspect([id])}>{fresh_.includes(id)&&<span className="new-badge">NEW</span>}<img src={card.src} alt={card.name}/><b>{card.name}</b><small>{rarityName(id)}{fresh_.includes(id)&&hpBonus(id)>0?` · +${hpBonus(id)}% HP`:""}</small></button>;})}</div><div className="summary-actions"><button className="primary-button" onClick={reset}><RotateCcw size={16}/>Open another pack</button><Link className="subtle-button" href="/collection"><Layers size={16}/>View collection<ArrowRight size={16}/></Link><Link className="subtle-button" href="/decks"><Layers size={16}/>Use in my deck<ArrowRight size={16}/></Link></div></section>}
    {inspect&&<CardTheater ids={inspect} title="Your discovery" inspection onDone={()=>setInspect(null)}/>}
  </div>;
}
