"use client";
import { useEffect, useState } from "react";
import { enableSound, sound } from "@/lib/game/sound";
import { MainMenu, StartScreen } from "./GameMenu";
import PracticeBattle from "./PracticeBattle";
const STARTED_KEY="cardsdotgg.started";

/** The home screen: title, main menu, and practice (the real duel rules against the computer, no wallet needed). */
export default function BattleGame(){
  const [tier,setTier]=useState(0),[practicing,setPracticing]=useState(false),[audio,setAudio]=useState(false);
  // The title screen shows once per browser session (sessionStorage), not on every refresh.
  const [started,setStarted]=useState<boolean|null>(null);
  useEffect(()=>{try{setStarted(sessionStorage.getItem(STARTED_KEY)==="1");}catch{setStarted(true);}},[]);
  // Matches take the whole screen; the browser's own fullscreen is a bonus where it is allowed (not on iPhone Safari).
  function goFullscreen(){try{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.({navigationUI:"hide"}).catch(()=>{});}catch{}}
  function leaveFullscreen(){try{if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});}catch{}}
  if(practicing)return <PracticeBattle tier={tier} onExit={()=>{leaveFullscreen();setPracticing(false);}}/>;
  return <div className="arena-page game-fullscreen game-menu">
    {started===false&&<StartScreen onStart={()=>{try{sessionStorage.setItem(STARTED_KEY,"1");}catch{}setStarted(true);goFullscreen();sound("rare");}}/>}
    {started!==null&&<MainMenu tier={tier} onTier={setTier} onBattle={()=>{goFullscreen();setPracticing(true);}} audio={audio} onAudio={()=>{setAudio(!audio);enableSound(!audio);}}/>}
  </div>;
}
