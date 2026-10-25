import { NextRequest, NextResponse } from 'next/server'
import { requireAgent } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET() {
 const auth=await requireAgent(); if(auth.error)return auth.error
 const {data,error}=await createServerSupabaseClient().from('whatsapp_saved_stickers').select('id,media_id').eq('agent_id',auth.agent.id).order('created_at',{ascending:false})
 return error?NextResponse.json({error:'Could not load stickers'},{status:500}):NextResponse.json({stickers:data??[]})
}
export async function POST(request:NextRequest) {
 const auth=await requireAgent();if(auth.error)return auth.error
 const {messageId}=await request.json().catch(()=>({}))
 if(typeof messageId!=='string')return NextResponse.json({error:'Message required'},{status:400})
 const db=createServerSupabaseClient()
 const {data:message,error}=await db.from('whatsapp_messages').select('attachment_name,attachment_url').eq('id',messageId).maybeSingle()
 if(error||!message||!/^sticker attachment$/i.test(message.attachment_name??''))return NextResponse.json({error:'Select a sticker message'},{status:400})
 const mediaId=new URL(message.attachment_url,'https://inbox.local').searchParams.get('mediaId')
 if(!mediaId)return NextResponse.json({error:'Sticker media unavailable'},{status:400})
 const {error:saveError}=await db.from('whatsapp_saved_stickers').upsert({agent_id:auth.agent.id,media_id:mediaId},{onConflict:'agent_id,media_id'})
 return saveError?NextResponse.json({error:'Could not save sticker'},{status:500}):NextResponse.json({saved:true})
}
export async function DELETE(request:NextRequest){
 const auth=await requireAgent();if(auth.error)return auth.error
 const {id}=await request.json().catch(()=>({}))
 const {error}=await createServerSupabaseClient().from('whatsapp_saved_stickers').delete().eq('id',id).eq('agent_id',auth.agent.id)
 return error?NextResponse.json({error:'Could not remove sticker'},{status:500}):NextResponse.json({removed:true})
}