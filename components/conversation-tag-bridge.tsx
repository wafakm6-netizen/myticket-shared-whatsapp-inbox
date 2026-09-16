'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { TagManager } from '@/components/tag-manager'

type InboxConversation={id:string;whatsapp_contacts?:{phone?:string}|{phone?:string}[]}

export function ConversationTagBridge(){
 const [host,setHost]=useState<HTMLElement|null>(null);const [conversationId,setConversationId]=useState<string|undefined>()
 useEffect(()=>{
  let stopped=false;let timer:number|undefined
  const sync=async()=>{
   const pane=document.querySelector('.details-pane') as HTMLElement|null
   if(!pane){setHost(null);setConversationId(undefined);return}
   let node=pane.querySelector('[data-conversation-tag-host]') as HTMLElement|null
   if(!node){node=document.createElement('section');node.dataset.conversationTagHost='true';node.className='detail-section conversation-tags-section';const sections=pane.querySelectorAll('.detail-section');if(sections.length>=3)pane.insertBefore(node,sections[2]);else pane.appendChild(node)}
   setHost(node)
   const dds=Array.from(pane.querySelectorAll('dl dd')).map(el=>(el.textContent||'').trim());const phone=dds.find(v=>v.startsWith('+')||/^\d{7,}$/.test(v.replace(/\s/g,'')))
   if(!phone){setConversationId(undefined);return}
   try{const r=await fetch('/api/inbox',{cache:'no-store'});if(!r.ok)return;const p=await r.json();const normalized=phone.replace(/\D/g,'');const row=(p.conversations??[] as InboxConversation[]).find((c:any)=>{const contact=Array.isArray(c.whatsapp_contacts)?c.whatsapp_contacts[0]:c.whatsapp_contacts;return String(contact?.phone||'').replace(/\D/g,'')===normalized});if(!stopped)setConversationId(row?.id)}catch{}
  }
  const schedule=()=>{window.clearTimeout(timer);timer=window.setTimeout(()=>void sync(),120)}
  void sync();const observer=new MutationObserver(schedule);observer.observe(document.body,{subtree:true,childList:true,characterData:true});return()=>{stopped=true;observer.disconnect();window.clearTimeout(timer)}
 },[])
 if(!host)return null
 return createPortal(<><div className="section-heading"><h3>Tags</h3></div>{conversationId?<TagManager conversationId={conversationId} compact/>:<p className="muted-copy">Select a conversation to manage tags.</p>}</>,host)
}
