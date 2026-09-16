'use client'

import { useEffect, useState } from 'react'
import { Tag, X } from 'lucide-react'
import { TagManager } from '@/components/tag-manager'

type ConversationRef = { id:string; phone:string; name:string }

export function TagNavBridge() {
  const [open,setOpen]=useState(false)
  const [selectedConversation,setSelectedConversation]=useState<ConversationRef|null>(null)

  useEffect(()=>{
    let cancelled=false
    const resolveSelected=async()=>{
      const pane=document.querySelector('.details-pane') as HTMLElement|null
      if(!pane){if(!cancelled)setSelectedConversation(null);return}
      const text=(pane.innerText||'').replace(/\s+/g,' ')
      try{
        const response=await fetch('/api/inbox',{cache:'no-store'}); if(!response.ok)return
        const payload=await response.json()
        const rows=payload.conversations??[]
        const matches=rows.map((row:any)=>{const contact=Array.isArray(row.whatsapp_contacts)?row.whatsapp_contacts[0]:row.whatsapp_contacts;return{id:row.id,phone:contact?.phone||'',name:contact?.display_name||''}}).filter((item:ConversationRef)=>item.phone&&text.includes(item.phone))
        const match=matches[0]||rows.map((row:any)=>{const contact=Array.isArray(row.whatsapp_contacts)?row.whatsapp_contacts[0]:row.whatsapp_contacts;return{id:row.id,phone:contact?.phone||'',name:contact?.display_name||''}}).find((item:ConversationRef)=>item.name&&text.includes(item.name))
        if(!cancelled)setSelectedConversation(match||null)
      }catch{}
    }
    const click=(event:MouseEvent)=>{const target=event.target as HTMLElement|null;const button=target?.closest('button[aria-label="Tags"]');if(button){event.preventDefault();event.stopPropagation();setOpen(true)}; window.setTimeout(()=>void resolveSelected(),80)}
    document.addEventListener('click',click,true)
    const observer=new MutationObserver(()=>{window.clearTimeout((window as any).__tagResolveTimer);(window as any).__tagResolveTimer=window.setTimeout(()=>void resolveSelected(),120)})
    observer.observe(document.body,{childList:true,subtree:true,characterData:true})
    void resolveSelected()
    return()=>{cancelled=true;document.removeEventListener('click',click,true);observer.disconnect()}
  },[])

  return <>
    {selectedConversation&&<div className="contact-tags-floating" aria-label="Conversation tags"><div className="contact-tags-heading"><span><Tag size={13}/> Tags</span><small>Click to add or remove</small></div><TagManager conversationId={selectedConversation.id} compact /></div>}
    {open&&<div className="tag-manager-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}><section className="tag-manager-modal" role="dialog" aria-modal="true" aria-labelledby="tag-manager-title"><div className="tag-manager-modal-header"><div className="tag-manager-heading"><span className="tag-manager-icon"><Tag size={18}/></span><div><p>WORKSPACE</p><h2 id="tag-manager-title">Tags</h2></div></div><button type="button" className="icon-btn" onClick={()=>setOpen(false)} aria-label="Close tags"><X size={18}/></button></div><p className="tag-manager-description">Create, edit and delete reusable labels. Choose a color such as red for Urgent.</p><div className="tag-manager-content"><TagManager /></div></section></div>}
  </>
}
