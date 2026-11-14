"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useWallet} from "@/lib/wallet";
import {useEffect,useState} from "react";
import {ArrowUpRight,Check,ChevronDown,Copy,Droplets,Gamepad2,Hexagon,Layers,LogOut,Store,Swords,Vault,Wallet,X} from "lucide-react";
import {rpc} from "@/lib/near";
import {NetworkGuard} from "@/components/NetworkGuard";
const links=[{href:"/",name:"Arena",icon:Swords},{href:"/arcade",name:"Arcade",icon:Gamepad2},{href:"/market",name:"Market",icon:Store},{href:"/collection",name:"Collection",icon:Layers},{href:"/decks",name:"Vault",icon:Vault}];
export default function AppShell({children}:{children:React.ReactNode}){
  const path=usePathname(),game=path==="/"||path==="/collection"||path==="/packs";
  // Full-screen game pages carry their own styles, so they skip the old legacy theme.
  const screens=["/deposit","/decks","/decks/build","/withdraw","/pool","/arena","/play","/leaderboard","/arcade","/market"].includes(path);
  const {accountId,ready,signIn:login,signOut:logout}=useWallet();
  const address=accountId,isConnected=!!accountId,authenticated=!!accountId||path==="/";
  const [walletOpen,setWalletOpen]=useState(false),[copied,setCopied]=useState(false),[balance,setBalance]=useState<string|null>(null);
  // Testnet NEAR balance, read when the wallet sheet opens (fees for every move come from it).
  useEffect(()=>{
    if(!walletOpen||!accountId)return;let live=true;setBalance(null);
    rpc<{amount:string}>("query",{request_type:"view_account",finality:"final",account_id:accountId}).then(a=>{if(live)setBalance((Number(BigInt(a.amount)/10n**20n)/1e4).toFixed(2));}).catch(()=>{if(live)setBalance("0.00");});
    return()=>{live=false;};
  },[walletOpen,accountId]);
  const copy=()=>{if(!accountId)return;navigator.clipboard?.writeText(accountId).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1500);}).catch(()=>{});};
  /** NEAR's official testnet faucet (built into the NEAR docs). It asks for the account name, so that is copied on the way out. */
  const FAUCET="https://docs.near.org/getting-started/faucet";
  // Every screen but the home arena (which holds the offline practice mode) needs a connected wallet.
  if(!authenticated)return <><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Lilita+One&display=swap"/>
    <div className="wallet-gate">
      <img className="wallet-gate-logo" src="/cardsdotgg-logo.jpg" alt="Cardsdotgg: collect, build, battle" draggable={false}/>
      <div className="wallet-gate-card">
        <h2>Sign in to play</h2>
        <p>Your deck, matches and yield live on NEAR testnet, so every player needs a wallet.</p>
        <button className="cm-btn wallet-gate-btn" disabled={!ready} onClick={()=>login()}>{ready?"SIGN IN":"LOADING…"}</button>
        <small className="wallet-gate-note">Use a NEAR testnet wallet such as MyNearWallet or HOT. Test tokens have no real value.</small>
      </div>
    </div></>;
  return <><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Lilita+One&display=swap"/><header className="site-header"><Link className="brand-lockup" href="/" aria-label="Cardsdotgg home"><span className="brand-icon"><Layers size={23} strokeWidth={1.7}/></span><b>Cardsdotgg</b></Link><nav className="desktop-nav" aria-label="Main navigation">{links.map(({href,name,icon:Icon})=><Link className={(href==="/decks"?!game:path===href)?"active":""} href={href} key={href}><Icon size={16}/>{name}</Link>)}</nav><div className="header-right"><span className="network-label"><span/>NEAR TESTNET</span><button className="wallet-button" onClick={()=>setWalletOpen(true)}><Wallet size={15}/><span>{isConnected?address!.length>18?`${address!.slice(0,8)}…${address!.slice(-6)}`:address!:"Connect wallet"}</span><ChevronDown size={12}/></button></div></header>
    <main className={game||screens?"game-main":"legacy-main"}>{game||screens?children:<NetworkGuard>{children}</NetworkGuard>}</main>
    <footer className="site-footer"><span><span className="footer-mark">◇</span> A little strategy. A little magic.</span><span>Cardsdotgg · Local preview<span className="footer-dot"/>Built on NEAR<ArrowUpRight size={11}/></span></footer>
    <nav className="mobile-nav" aria-label="Mobile navigation">{links.map(({href,name,icon:Icon})=><Link className={(href==="/decks"?!game:path===href)?"active":""} href={href} key={href}><Icon size={20}/><span>{name}</span></Link>)}</nav>
    {walletOpen&&<div className="modal-backdrop" onClick={()=>setWalletOpen(false)}><section className="confirmation wallet-dialog wd" role="dialog" aria-modal="true" aria-label="Wallet" onClick={e=>e.stopPropagation()}>
      <button className="wd-close" onClick={()=>setWalletOpen(false)} aria-label="Close wallet"><X size={18} strokeWidth={3}/></button>
      <span className="wd-icon"><Wallet size={26} strokeWidth={2.4}/></span>
      <h2>{isConnected?"Your wallet":"Connect your wallet"}</h2>
      <p>Your NEAR testnet wallet plays matches, opens packs and holds your cards. Test NEAR is free and has no real value.</p>
      {isConnected?<>
        <div className="wd-acct"><span className="wd-net">TESTNET</span><code title={address!}>{address}</code><button className="wd-copy" onClick={copy} aria-label="Copy account name">{copied?<Check size={15}/>:<Copy size={15}/>}{copied?"Copied":"Copy"}</button></div>
        <div className="wd-bal"><small>Balance</small><b>{balance??"…"} <i>NEAR</i></b>{balance!==null&&Number(balance)<1&&<span className="wd-low">Low: top up for fees</span>}</div>
        <a className="cm-btn cm-packs wd-btn" href={FAUCET} target="_blank" rel="noreferrer" onClick={copy}><Droplets size={20}/>GET TESTNET NEAR</a>
        <small className="wd-hint">Opens NEAR's official faucet. Your account name is copied: paste it and tap Request.</small>
        <button className="cm-btn cm-collection wd-btn" onClick={()=>{logout();setWalletOpen(false);}}><LogOut size={18}/>SIGN OUT</button>
      </>:<>
        <button className="cm-btn cm-play wd-btn" onClick={()=>{setWalletOpen(false);login();}}><Wallet size={20}/>SIGN IN</button>
        <a className="cm-btn cm-packs wd-btn" href={FAUCET} target="_blank" rel="noreferrer"><Droplets size={20}/>GET TESTNET NEAR</a>
        <small className="wd-hint">New to NEAR? Create a testnet account in your wallet, then fill it from NEAR's official faucet.</small>
      </>}
    </section></div>}
  </>;
}
