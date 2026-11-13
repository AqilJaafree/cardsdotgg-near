"use client";
import { Leaf, Flame, Zap, Hexagon } from "lucide-react";
import dynamic from "next/dynamic";
import { cardById } from "@/lib/game/catalog";
import HoloCard from "./HoloCard";
import type { BattleState, Fighter } from "@/lib/game/simulation";
import type { EffectEvent } from "./BattleEffects";
const BattleEffects=dynamic(()=>import("./BattleEffects"),{ssr:false});
export function Energy({tier=0}:{tier?:number}){const Icon=tier===0?Leaf:tier===1?Zap:Flame;return <span className={`energy-orb energy-${tier}`}><Icon size={13} fill="currentColor"/></span>;}
function CombatCard({unit,onClick,active=false,side,tier,attacking}:{unit:Fighter;onClick:()=>void;active?:boolean;side:string;tier:number;attacking?:boolean}){
  const card=cardById(unit.id);
  return <button className={`combat-card ${active?"combat-active":""} ${attacking?"lunging":""} ${side}`} onClick={onClick} aria-label={`${card.name}, ${unit.hp} HP. ${active?"Inspect":"Switch or inspect"}`}>
    <HoloCard rarity={card.rarity}><img src={card.src} alt={card.name} draggable={false}/></HoloCard>
    {active&&<><span className="hp-badge"><small>HP</small>{unit.hp}</span><span className="hp-track"><i style={{width:`${Math.max(0,unit.hp/unit.maxHp)*100}%`,background:unit.hp/unit.maxHp<.3?"#eb795d":undefined}}/></span><span className="attached-energy">{Array.from({length:unit.energy},(_,i)=><Energy key={i} tier={tier}/>)}</span></>}
    {!active&&<span className="bench-hp">{unit.hp}</span>}
  </button>;
}
export default function BattleBoard({state,tier,opponentName="ASTER",opponentTag="Practice opponent",onInspect,onBench,phase,banner,attack,effect,children,onActive,openingStage,knockout,swapping}:{state:BattleState;tier:number;opponentName?:string;opponentTag?:string;onInspect:(ids:number[])=>void;onBench?:(index:number)=>void;phase:string;onActive?:()=>void;openingStage?:string;knockout?:"player"|"opponent";swapping?:boolean;banner?:string;attack?:"player"|"opponent";effect?:EffectEvent;children?:React.ReactNode}){
  return <div className={`battle-board phase-${phase} opening-stage-${openingStage} ${knockout?`knockout-${knockout}`:""} ${swapping?"swapping-cards":""}`}>
    <div className="table-surface"><div className="red-field"/><div className="blue-field"/><div className="table-line"/><div className="table-emblem"><i/></div><div className="field-orbit"/></div>
    <div className="player-strip enemy-strip"><span className="avatar enemy-avatar">{opponentName[0]}</span><div><b>{opponentName}</b><small>{opponentTag}</small></div><div className="score-pips">{[0,1,2].map(i=><i key={i} className={state.opponent.points>i?"scored":""}>{state.opponent.points>i?"✦":""}</i>)}</div></div>
    <div className="opponent-hand">{[0,1,2,3,4].map(i=><img key={i} src="/cards/back.svg" alt="Opponent’s hidden card" style={{transform:`rotate(${(i-2)*9}deg) translateY(${Math.abs(i-2)*4}px)`}}/>)}</div>
    <div className="bench-row opponent-bench">{[0,1,2].map(i=><div className="bench-slot" key={i} style={{"--deal-index":i} as React.CSSProperties}>{state.opponent.bench[i]&&<CombatCard unit={state.opponent.bench[i]} tier={2} side="opponent" onClick={()=>onInspect([state.opponent.bench[i].id])}/>}</div>)}</div>
    <div className="active-slot opponent-active"><CombatCard key={state.opponent.active.id} active unit={state.opponent.active} tier={2} side="opponent" attacking={attack==="opponent"} onClick={()=>onInspect([state.opponent.active.id])}/></div>
    <div className="deck-stack enemy-deck"><img src="/cards/back.svg" alt="Opponent draw pile"/><span>{state.opponent.hand.length}</span></div>
    <div className="turn-marker"><span>ROUND</span><b>{String(state.turn).padStart(2,"0")}</b></div>
    <div className="active-slot player-active"><CombatCard key={state.player.active.id} active unit={state.player.active} tier={tier} side="player" attacking={attack==="player"} onClick={()=>onActive?onActive():onInspect([state.player.active.id])}/></div>
    <div className="bench-row player-bench">{[0,1,2].map(i=><div className="bench-slot" key={i} style={{"--deal-index":i} as React.CSSProperties}>{state.player.bench[i]&&<CombatCard unit={state.player.bench[i]} tier={tier} side="player" onClick={()=>onBench?onBench(i):onInspect([state.player.bench[i].id])}/>}</div>)}</div>
    <div className="deck-stack player-deck"><img src="/cards/back.svg" alt="Your draw pile"/><span>{state.player.hand.length}</span></div>
    <div className={`energy-zone ${state.energyUsed?"spent":""}`}><Energy tier={tier}/><small>ENERGY</small></div>
    <div className="player-hand">{state.player.hand.map((id,i)=><button key={`${i}-${id}`} style={{"--deal-index":i,"--card-angle":`${(i-(state.player.hand.length-1)/2)*9}deg`,"--card-y":`${Math.abs(i-(state.player.hand.length-1)/2)*7}px`} as React.CSSProperties} onClick={()=>onInspect([id])} aria-label={`Inspect ${cardById(id).name}`}><img src={cardById(id).src} alt={cardById(id).name} draggable={false}/></button>)}</div>
    <div className="player-strip own-strip"><span className="avatar own-avatar"><Hexagon size={15}/></span><div><b>YOU</b><small>{["Guardian","Balanced","Degen"][tier]}</small></div><div className="score-pips">{[0,1,2].map(i=><i key={i} className={state.player.points>i?"scored":""}>{state.player.points>i?"✦":""}</i>)}</div></div>
    {banner&&<div className={`turn-banner ${banner.includes("opponent")?"enemy-turn":""}`} key={banner}>{banner}<small>{banner.includes("turn")?`Current turn: ${banner.includes("opponent")?state.turn*2:state.turn*2-1}`:"CARDSDOTGG ARENA"}</small></div>}
    <BattleEffects event={effect}/>
    {children}
  </div>;
}
