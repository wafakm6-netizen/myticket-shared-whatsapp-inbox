'use client'

import { useEffect, useState } from 'react'
import { Tag, X } from 'lucide-react'
import { TagManager } from '@/components/tag-manager'

type TagItem={id:string;name:string;color?:string}
type AssignTarget={id:string;name:string}|null

export function TagNavBridge(){
 const [open,setOpen]=useState(false)
 const [assignTarget,setAssignTarget]=useState<AssignTarget>(null)
 const [refreshKey,setRefreshKey]=useState(0)

 useEffect(()=>{
  let cancelled=false
  let timer:number|undefined
  const clearInjected=()=>document.querySelectorAll('.conversation-inline-tags,.conversation-tag-add').forEach(node=>node.remove())
  const renderConversationTags=async()=>{
   try{
    const response=await fetch('/api/inbox',{cache:'no-store'});if(!response.ok)return
    const payload=await response.json();if(cancelled)return
    clearInjected()
    const cards=Array.from(document.querySelectorAll('button.conversation')) as HTMLElement[]
    const rows=payload.conversations??[]
    cards.forEach((card,index)=>{
      const row=rows[index];if(!row)return
      const contact=Array.isArray(row.whatsapp_contacts)?row.whatsapp_contacts[0]:row.whatsapp_contacts
      const typeBadge=card.querySelector('.type-badge') as HTMLElement|null;if(!typeBadge)return
      const assignments=row.whatsapp_conversation_tags??[]
      const tags:TagItem[]=assignments.map((a:any)=>{const t=Array.isArray(a.whatsapp_tags)?a.whatsapp_tags[0]:a.whatsapp_tags;return t}).filter(Boolean)
      if(tags.length){const wrap=document.createElement('span');wrap.className='conversation-inline-tags';tags.forEach(t=>{const pill=document.createElement('span');pill.className=`conversation-inline-tag tag-pill-${t.color||'gray'}`;pill.textContent=t.name;wrap.appendChild(pill)});typeBadge.insertAdjacentElement('afterend',wrap)}
      const add=document.createElement('span');add.className='conversation-tag-add';add.textContent='+';add.title='Add or remove tags';add.setAttribute('role','button');add.setAttribute('tabindex','0');add.dataset.conversationId=row.id;add.dataset.conversationName=contact?.display_name||'Conversation';(tags.length?typeBadge.parentElement?.querySelector('.conversation-inline-tags'):typeBadge)?.insertAdjacentElement('afterend',add)
    })
   }catch{}
  }
  const schedule=()=>{window.clearTimeout(timer);timer=window.setTimeout(()=>void renderConversationTags(),100)}
  const click=(event:MouseEvent)=>{const target=event.target as HTMLElement|null;const add=target?.closest('.conversation-tag-add') as HTMLElement|null;if(add){event.preventDefault();event.stopPropagation();setAssignTarget({id:add.dataset.conversationId||'',name:add.dataset.conversationName||'Conversation'});return}const button=target?.closest('button[aria-label="Tags"]');if(button){event.preventDefault();event.stopPropagation();setOpen(true)}}
  document.addEventListener('click',click,true)
  const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true})
  void renderConversationTags()
  return()=>{cancelled=true;document.removeEventListener('click',click,true);observer.disconnect();window.clearTimeout(timer);clearInjected()}
 },[refreshKey])

 const changed=()=>setRefreshKey(v=>v+1)
 return <>
  {open&&<div className="tag-manager-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}><section className="tag-manager-modal" role="dialog" aria-modal="true" aria-labelledby="tag-manager-title"><div className="tag-manager-modal-header"><div className="tag-manager-heading"><span className="tag-manager-icon"><Tag size={18}/></span><div><p>WORKSPACE</p><h2 id="tag-manager-title">Tags</h2></div></div><button type="button" className="icon-btn" onClick={()=>setOpen(false)} aria-label="Close tags"><X size={18}/></button></div><p className="tag-manager-description">Create, edit and delete reusable labels. Choose a color such as red for Urgent.</p><div className="tag-manager-content"><TagManager onChanged={changed}/></div></section></div>}
  {assignTarget&&<div className="tag-manager-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setAssignTarget(null)}}><section className="tag-manager-modal tag-assignment-modal" role="dialog" aria-modal="true"><div className="tag-manager-modal-header"><div className="tag-manager-heading"><span className="tag-manager-icon"><Tag size={18}/></span><div><p>CONVERSATION</p><h2>Tags for {assignTarget.name}</h2></div></div><button type="button" className="icon-btn" onClick={()=>setAssignTarget(null)} aria-label="Close conversation tags"><X size={18}/></button></div><p className="tag-manager-description">Click a tag to add it. Click an assigned tag again to remove it.</p><div className="tag-manager-content"><TagManager conversationId={assignTarget.id} compact onChanged={changed}/></div></section></div>}
 </>
}
