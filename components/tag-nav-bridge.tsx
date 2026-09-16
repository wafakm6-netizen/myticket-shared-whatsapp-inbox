'use client'

import { useEffect, useState } from 'react'
import { Tag, X } from 'lucide-react'
import { TagManager } from '@/components/tag-manager'

type TagItem={id:string;name:string;color?:string}
type ConversationRef={id:string;phone:string;name:string;tags:TagItem[]}

export function TagNavBridge(){
 const [open,setOpen]=useState(false)
 useEffect(()=>{
  let cancelled=false
  const clearBadges=()=>document.querySelectorAll('.conversation-inline-tags').forEach(node=>node.remove())
  const renderConversationTags=async()=>{
   try{
    const response=await fetch('/api/inbox',{cache:'no-store'});if(!response.ok)return
    const payload=await response.json();if(cancelled)return
    clearBadges()
    const cards=Array.from(document.querySelectorAll('.conversation-item')) as HTMLElement[]
    for(const row of payload.conversations??[]){
     const contact=Array.isArray(row.whatsapp_contacts)?row.whatsapp_contacts[0]:row.whatsapp_contacts
     const assignments=row.whatsapp_conversation_tags??[]
     const tags:TagItem[]=assignments.map((a:any)=>{const t=Array.isArray(a.whatsapp_tags)?a.whatsapp_tags[0]:a.whatsapp_tags;return t}).filter(Boolean)
     if(!tags.length)continue
     const card=cards.find(el=>{const text=(el.innerText||'').replace(/\s+/g,' ');return(contact?.phone&&text.includes(contact.phone))||(contact?.display_name&&text.includes(contact.display_name))})
     if(!card)continue
     const typeBadge=Array.from(card.querySelectorAll('span')).find(el=>['Customer','Supplier'].includes((el.textContent||'').trim())) as HTMLElement|undefined
     if(!typeBadge)continue
     const wrap=document.createElement('span');wrap.className='conversation-inline-tags'
     tags.forEach(t=>{const pill=document.createElement('span');pill.className=`conversation-inline-tag tag-pill-${t.color||'gray'}`;pill.textContent=t.name;wrap.appendChild(pill)})
     typeBadge.insertAdjacentElement('afterend',wrap)
    }
   }catch{}
  }
  const click=(event:MouseEvent)=>{const target=event.target as HTMLElement|null;const button=target?.closest('button[aria-label="Tags"]');if(button){event.preventDefault();event.stopPropagation();setOpen(true)};window.setTimeout(()=>void renderConversationTags(),100)}
  document.addEventListener('click',click,true)
  const observer=new MutationObserver(()=>{window.clearTimeout((window as any).__tagBadgeTimer);(window as any).__tagBadgeTimer=window.setTimeout(()=>void renderConversationTags(),140)})
  observer.observe(document.body,{childList:true,subtree:true})
  void renderConversationTags()
  return()=>{cancelled=true;document.removeEventListener('click',click,true);observer.disconnect();clearBadges()}
 },[])
 return <>{open&&<div className="tag-manager-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}><section className="tag-manager-modal" role="dialog" aria-modal="true" aria-labelledby="tag-manager-title"><div className="tag-manager-modal-header"><div className="tag-manager-heading"><span className="tag-manager-icon"><Tag size={18}/></span><div><p>WORKSPACE</p><h2 id="tag-manager-title">Tags</h2></div></div><button type="button" className="icon-btn" onClick={()=>setOpen(false)} aria-label="Close tags"><X size={18}/></button></div><p className="tag-manager-description">Create, edit and delete reusable labels. Choose a color such as red for Urgent.</p><div className="tag-manager-content"><TagManager onChanged={()=>window.setTimeout(()=>window.location.reload(),120)}/></div></section></div>}</>
}
