"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { SEASON, decks } from "@/lib/game/catalog";
/** Pack art by tab: the three deck packs, then the season pack. */
const PACKS = [...decks.map((d) => d.pack), SEASON.pack];
import { cardMesh, disposeScene, loadTexture, smooth } from "@/lib/game/three-utils";
export type PackPhase="choose"|"sealed"|"opening";
export default function PackScene({tier,phase,selected,onSelect}:{tier:number;phase:PackPhase;selected:number;onSelect:(id:number)=>void}){
  const host=useRef<HTMLDivElement>(null),[failed,setFailed]=useState(false);
  const state=useRef({tier,phase,selected});state.current={tier,phase,selected};
  const select=useRef(onSelect);select.current=onSelect;
  useEffect(()=>{
    const el=host.current;if(!el)return;
    let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"high-performance"});}catch{setFailed(true);return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));el.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.1,80);camera.position.set(0,.15,10);
    const loader=new THREE.TextureLoader(),textures=PACKS.map(p=>loadTexture(loader,p)),back=loadTexture(loader,"/cards/back.svg");
    const packs:THREE.Group[]=[],reflections:THREE.Group[]=[];
    for(let i=0;i<10;i++){
      const pack=cardMesh(textures[0],back,2.15,3.44);pack.userData.index=i;scene.add(pack);packs.push(pack);
      const reflection=cardMesh(textures[0],back,2.15,3.44);reflection.scale.y=-1;
      reflection.traverse(o=>{if(o instanceof THREE.Mesh){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.transparent=true;m.opacity=.08;m.depthWrite=false;}}});scene.add(reflection);reflections.push(reflection);
    }
    const capTexture=textures.map(t=>{const c=t.clone();c.repeat.set(1,.13);c.offset.set(0,.87);c.needsUpdate=true;return c;});
    const lowerTexture=textures.map(t=>{const c=t.clone();c.repeat.set(1,.87);c.offset.set(0,0);c.needsUpdate=true;return c;});
    const cap=new THREE.Mesh(new THREE.PlaneGeometry(2.15,.4472),new THREE.MeshBasicMaterial({map:capTexture[0],side:THREE.DoubleSide}));
    const lower=new THREE.Mesh(new THREE.PlaneGeometry(2.15,2.9928),new THREE.MeshBasicMaterial({map:lowerTexture[0],side:THREE.DoubleSide}));scene.add(cap,lower);cap.visible=false;lower.visible=false;
    const particles=new Float32Array(90*3);for(let i=0;i<particles.length;i++)particles[i]=(Math.random()-.5)*14;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.BufferAttribute(particles,3));const stars=new THREE.Points(geometry,new THREE.PointsMaterial({color:0xc3af7c,size:.035,transparent:true,opacity:.65}));scene.add(stars);
    let dragStart=0,down=false,drag=0;
    const pointerDown=(e:PointerEvent)=>{if(state.current.phase!=="choose")return;dragStart=e.clientX;down=true;el.setPointerCapture(e.pointerId);};
    const pointerMove=(e:PointerEvent)=>{if(down)drag=(e.clientX-dragStart)/Math.max(el.clientWidth,1)*3;};
    const pointerUp=(e:PointerEvent)=>{if(!down)return;down=false;if(Math.abs(e.clientX-dragStart)>25)select.current((state.current.selected+(e.clientX<dragStart?1:9))%10);else{
      const rect=el.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
      const hits=ray.intersectObjects(packs,true);if(hits.length){const parent=hits[0].object.parent;select.current(parent?.userData.index??state.current.selected);}
    }drag=0;};
    el.addEventListener("pointerdown",pointerDown);el.addEventListener("pointermove",pointerMove);el.addEventListener("pointerup",pointerUp);el.addEventListener("pointercancel",pointerUp);
    const resize=()=>{const w=el.clientWidth,h=el.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.position.z=camera.aspect<.65?12:9.6;camera.updateProjectionMatrix();};const observer=new ResizeObserver(resize);observer.observe(el);resize();
    let frame=0,angle=0,lastTier=-1,lastPhase="",phaseAt=0;const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animate=(now:number)=>{
      frame=requestAnimationFrame(animate);const s=state.current;
      if(s.tier!==lastTier){packs.forEach(p=>{(p.children[1]as THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>).material.map=textures[s.tier];});reflections.forEach(p=>{(p.children[1]as THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>).material.map=textures[s.tier];});cap.material.map=capTexture[s.tier];lower.material.map=lowerTexture[s.tier];lastTier=s.tier;}
      if(s.phase!==lastPhase){phaseAt=now;lastPhase=s.phase;}
      let target=-s.selected*Math.PI*2/10;while(target-angle>Math.PI)target-=Math.PI*2;while(target-angle< -Math.PI)target+=Math.PI*2;
      angle+=(target+drag-angle)*(reduced?1:.09);
      const elapsed=(now-phaseAt)/1000,focus=s.phase==="choose"?0:smooth(elapsed/.7);
      packs.forEach((p,i)=>{const a=angle+i*Math.PI*2/10,isSelected=i===s.selected;
        p.visible=s.phase!=="opening"&&(s.phase==="choose"||isSelected||focus<1);
        p.position.set(Math.sin(a)*4.4*(1-(isSelected?focus:0)),Math.sin(now*.001+i)*.045,Math.cos(a)*2.4-2.4+(isSelected?focus*.65:0));
        p.rotation.y=a*.35*(1-focus)+(isSelected&&s.phase==="sealed"?Math.sin(now*.0007)*.12:0);p.rotation.z=isSelected&&s.phase==="sealed"?Math.sin(now*.0006)*.025:0;
        p.scale.setScalar(isSelected?1+focus*.18:1-focus);
        const r=reflections[i];r.visible=s.phase==="choose";r.position.copy(p.position);r.position.y=-3.56;r.rotation.copy(p.rotation);
      });
      cap.visible=lower.visible=s.phase==="opening";
      if(s.phase==="opening"){
        const open=smooth(elapsed/1.1);cap.position.set(open*2,1.7+open*2,.65);cap.rotation.z=-open*.9;lower.position.set(0,-.22-open*2.5,.65);lower.rotation.z=open*.08;
        cap.material.transparent=lower.material.transparent=true;cap.material.opacity=lower.material.opacity=1-smooth((elapsed-.7)/.6);
      }
      if(!reduced)stars.rotation.y=now*.00004;
      renderer.render(scene,camera);
    };frame=requestAnimationFrame(animate);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();el.removeEventListener("pointerdown",pointerDown);el.removeEventListener("pointermove",pointerMove);el.removeEventListener("pointerup",pointerUp);el.removeEventListener("pointercancel",pointerUp);disposeScene(scene);[...textures,...capTexture,...lowerTexture,back].forEach(t=>t.dispose());renderer.dispose();renderer.domElement.remove();};
  },[]);
  return <div ref={host} className={`pack-scene ${phase}`} role="img" aria-label="Rotating 3D booster packs. Use the previous and next pack buttons to choose.">{failed&&<img src={PACKS[tier]} alt={`${decks[tier]?.name??SEASON.name} booster pack`} className={`pack-fallback ${phase}`}/>}</div>;
}
