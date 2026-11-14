"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ChevronLeft, ChevronRight, X, ArrowRight, Sparkles } from "lucide-react";
import { cardById } from "@/lib/game/catalog";
import { cardMesh, loadTexture, disposeScene, smooth } from "@/lib/game/three-utils";
import { sound } from "@/lib/game/sound";

/** A dedicated 3D scene, shared by pre-battle showcases and card inspection. */
/** A card to show that is not in the picture catalog, e.g. the photo of a tokenized physical card. */
export type TheaterCard = { src: string; name: string; rarity: string };

export default function CardTheater({ ids, cards, title = "Your battle lineup", onDone, inspection = false, pack = false }: { ids: number[]; cards?: TheaterCard[]; title?: string; onDone: () => void; inspection?: boolean; pack?: boolean }) {
  const look = (i: number): TheaterCard => cards?.[i] ?? cardById(ids[i]);
  const host = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [index,setIndex] = useState(0), [failed,setFailed] = useState(false), [auto,setAuto] = useState(!inspection&&!pack);
  const indexRef = useRef(0); const indexChanged = useRef(0);
  const finish = useRef(onDone); finish.current = onDone;
  useEffect(() => { indexRef.current = index; indexChanged.current = performance.now(); sound(pack&&look(index).rarity==="Holo Rare"?"rare":"flip"); }, [index]);
  useEffect(() => {
    if (!auto || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setIndex((previous) => { if (previous >= ids.length - 1) { setAuto(false); return previous; } return previous + 1; }), 2250);
    return () => clearInterval(timer);
  }, [auto, ids.length]);
  useEffect(() => {
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    const priorFocus = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => {
      if(e.key === "Tab") {
        const focusable=dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        if(focusable?.length){const first=focusable[0],last=focusable[focusable.length-1];
          if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
          else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
        }
      }
 if(e.key === "Escape") finish.current(); if(e.key === "ArrowRight") { setAuto(false); setIndex(i => Math.min(ids.length-1,i+1)); } if(e.key === "ArrowLeft") { setAuto(false); setIndex(i => Math.max(0,i-1)); } };
    window.addEventListener("keydown",key);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown",key); priorFocus?.focus(); };
  }, [ids.length]);
  useEffect(() => {
    const el = host.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:"high-performance" }); } catch { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio,2)); el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38,1,.1,100);
    camera.position.z = 7.5;
    const loader = new THREE.TextureLoader(); const back = loadTexture(loader,"/cards/back.svg");
    const textures = ids.map((_, i) => loadTexture(loader,look(i).src));
    const hero = cardMesh(textures[0],back); scene.add(hero);
    const foil = new THREE.Mesh(new THREE.PlaneGeometry(2.5,3.4375),new THREE.ShaderMaterial({ transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, uniforms:{time:{value:0},strength:{value:.15}}, vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`varying vec2 vUv;uniform float time;uniform float strength;void main(){float stripe=pow(max(0.,sin((vUv.x+vUv.y*.65)*4.+time)),18.);vec3 rainbow=.5+.5*cos(6.28318*(vUv.x+time*.08+vec3(0.,.33,.67)));float art=step(.15,vUv.x)*step(vUv.x,.86)*step(.44,vUv.y)*step(vUv.y,.84);gl_FragColor=vec4(rainbow,stripe*strength*(.2+.8*art));}` }));
    foil.position.z=.03; hero.add(foil);
    const floaters: THREE.Group[] = [];
    for(let i=0;i<18;i++){const object=cardMesh(textures[i%textures.length],back,.38,.5225);object.position.set(Math.sin(i*2.4)*(2.7+i%3),Math.cos(i*1.7)*4,-3-i%5);object.rotation.set(i*.24,i*.45,i*.31);scene.add(object);floaters.push(object);}
    const points = new Float32Array(450*3);
    for(let i=0;i<points.length;i++) points[i]=(Math.random()-.5)*20;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.BufferAttribute(points,3));
    const stars=new THREE.Points(geometry,new THREE.PointsMaterial({color:0xd5e7ff,size:.027,transparent:true,opacity:.8}));scene.add(stars);
    const pointer={x:0,y:0};const move=(e:PointerEvent)=>{const r=el.getBoundingClientRect();pointer.x=((e.clientX-r.left)/r.width-.5)*2;pointer.y=((e.clientY-r.top)/r.height-.5)*2;};
    el.addEventListener("pointermove",move);
    const resize=()=>{const w=el.clientWidth,h=el.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.position.z=camera.aspect<.65?9.3:7.5;camera.updateProjectionMatrix();};
    const observer=new ResizeObserver(resize);observer.observe(el);resize();
    let frame=0,last=-1; const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
    function animate(now:number){
      frame=requestAnimationFrame(animate);
      const idx=indexRef.current; if(idx!==last){(hero.children[1] as THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>).material.map=textures[idx];last=idx;indexChanged.current=now;}
      const elapsed=(now-indexChanged.current)/1000,t=now/1000;
      hero.rotation.y=reduced?0:Math.PI*(1-smooth(elapsed/.85))+Math.sin(t*.7)*.13+pointer.x*.18;
      hero.rotation.x=reduced?0:-pointer.y*.10+Math.sin(t*.8)*.035;
      hero.rotation.z=reduced?0:Math.sin(t*.6)*.025;
      hero.position.y=reduced?0:Math.sin(t*.9)*.07;
      hero.scale.setScalar(reduced?1:.86+smooth(elapsed/1.05)*.14);
      (foil.material as THREE.ShaderMaterial).uniforms.time.value=t*1.15;
      (foil.material as THREE.ShaderMaterial).uniforms.strength.value=look(idx).rarity==="Holo Rare"?.35:.09;
      if(!reduced){floaters.forEach((f,i)=>{f.rotation.y+=.002;f.position.y+=Math.sin(t*.25+i)*.001;});stars.rotation.y=t*.012;}
      renderer.render(scene,camera);
    }
    frame=requestAnimationFrame(animate);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();el.removeEventListener("pointermove",move);disposeScene(scene);textures.forEach(t=>t.dispose());back.dispose();renderer.dispose();renderer.domElement.remove();};
  // The lineup is immutable for a mounted showcase; transitions use refs to preserve its renderer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const card=look(index);
  return <div ref={dialog} className="theater" role="dialog" aria-modal="true" aria-label={title}>
    <div className="theater-aurora"/>
    <header className="theater-header"><div><span className="eyebrow">{pack?"A NEW DISCOVERY":inspection?"THE COLLECTION":"BEFORE THE BATTLE"}</span><h2>{title}</h2></div><button autoFocus className="round-button light" onClick={onDone} aria-label={pack?"Collect all cards":inspection?"Close card":"Skip showcase"}><X size={20}/></button></header>
    <div ref={host} className="theater-canvas"/>
    {failed&&<img className="theater-fallback" src={card.src} alt={card.name}/>}
    <div className="theater-bottom"><div className="card-rarity"><Sparkles size={13}/>{card.rarity}</div><h2>{card.name}</h2><div className="theater-pagination"><button className="round-button light" disabled={index===0} aria-label="Previous card" onClick={()=>{setAuto(false);setIndex(index-1);}}><ChevronLeft size={19}/></button><span>{String(index+1).padStart(2,"0")} <i>/ {String(ids.length).padStart(2,"0")}</i></span><button className="round-button light" disabled={index===ids.length-1} aria-label="Next card" onClick={()=>{setAuto(false);setIndex(index+1);}}><ChevronRight size={19}/></button></div>
    {!inspection&&<button className="primary-button theater-enter" onClick={()=>pack&&index<ids.length-1?setIndex(index+1):onDone()}>{pack?index===ids.length-1?"Add to collection":"Reveal next card":index===ids.length-1?"Enter the arena":"Skip to battle"}<ArrowRight size={17}/></button>}</div>
    <div className="theater-progress">{ids.map((id,i)=><button key={`${id}-${i}`} aria-label={`Show ${look(i).name}`} className={i===index?"current":i<index?"seen":""} onClick={()=>{setAuto(false);setIndex(i);}}/>)}</div>
  </div>;
}
