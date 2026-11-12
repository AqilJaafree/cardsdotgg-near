"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useWallet} from "@/lib/wallet";
import {useState} from "react";
import {ArrowUpRight,ChevronDown,Hexagon,Layers,Package,Swords,Vault,Wallet,X} from "lucide-react";
import {NetworkGuard} from "@/components/NetworkGuard";
const links=[{href:"/",name:"Arena",icon:Swords},{href:"/collection",name:"Collection",icon:Layers},{href:"/packs",name:"Packs",icon:Package},{href:"/decks",name:"Vault",icon:Vault}];
export default function AppShell({children}:{children:React.ReactNode}){
  const path=usePathname(),game=path==="/"||path==="/collection"||path==="/packs";
  const {accountId,ready,signIn:login,signOut:logout}=useWallet();
  const address=accountId,isConnected=!!accountId,authenticated=!!accountId;
  const [walletOpen,setWalletOpen]=useState(false);
  // Every screen needs a connected wallet: until one is connected, only the connect screen shows.
  if(!authenticated)return <><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lilita+One&display=swap"/>
    <div className="wallet-gate">
      <img className="wallet-gate-logo" src="/cardsdotgg-logo.jpg" alt="Cardsdotgg: collect, build, battle" draggable={false}/>
      <div className="wallet-gate-card">
        <h2>Sign in to play</h2>
        <p>Your deck, matches and yield live on NEAR testnet, so every player needs a wallet.</p>
        <button className="cm-btn wallet-gate-btn" disabled={!ready} onClick={()=>login()}>{ready?"SIGN IN":"LOADING…"}</button>
        <small className="wallet-gate-note">Use a NEAR testnet wallet such as MyNearWallet or HOT. Test tokens have no real value.</small>
      </div>
    </div></>;
  return <><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lilita+One&display=swap"/><header className="site-header"><Link className="brand-lockup" href="/" aria-label="Cardsdotgg home"><span className="brand-icon"><Layers size={23} strokeWidth={1.7}/></span><b>Cardsdotgg</b></Link><nav className="desktop-nav" aria-label="Main navigation">{links.map(({href,name,icon:Icon})=><Link className={(href==="/decks"?!game:path===href)?"active":""} href={href} key={href}><Icon size={16}/>{name}</Link>)}</nav><div className="header-right"><span className="network-label"><span/>NEAR TESTNET</span><button className="wallet-button" onClick={()=>setWalletOpen(true)}><Wallet size={15}/><span>{isConnected?address!.length>18?`${address!.slice(0,8)}…${address!.slice(-6)}`:address!:"Connect wallet"}</span><ChevronDown size={12}/></button></div></header>
    <main className={game?"game-main":"legacy-main"}>{game?children:<NetworkGuard>{children}</NetworkGuard>}</main>
    <footer className="site-footer"><span><span className="footer-mark">◇</span> A little strategy. A little magic.</span><span>Cardsdotgg · Local preview<span className="footer-dot"/>Built on NEAR<ArrowUpRight size={11}/></span></footer>
    <nav className="mobile-nav" aria-label="Mobile navigation">{links.map(({href,name,icon:Icon})=><Link className={(href==="/decks"?!game:path===href)?"active":""} href={href} key={href}><Icon size={20}/><span>{name}</span></Link>)}</nav>
    {walletOpen&&<div className="modal-backdrop"><section className="confirmation wallet-dialog" role="dialog" aria-modal="true" aria-label="Wallet"><button className="round-button dismiss" onClick={()=>setWalletOpen(false)} aria-label="Close wallet dialog"><X size={18}/></button><span className="brand-icon"><Wallet size={23}/></span><h2>{isConnected?"Your wallet":"Connect your wallet"}</h2><p>Use your NEAR wallet for the testnet vault and onchain challenges. Local practice and packs work without one.</p>{isConnected?<><code>{address}</code><button className="subtle-button" onClick={()=>{logout();setWalletOpen(false);}}>Sign out</button></>:<button className="primary-button" onClick={()=>{setWalletOpen(false);login();}}>Sign in<ArrowUpRight size={15}/></button>}</section></div>}
  </>;
}
