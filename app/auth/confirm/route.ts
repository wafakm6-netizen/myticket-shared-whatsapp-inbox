import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
export async function GET(request:NextRequest){
 const token_hash=request.nextUrl.searchParams.get('token_hash')
 const type=request.nextUrl.searchParams.get('type')
 const destination=new URL('/auth/accept-invite',request.url)
 if(!token_hash||type!=='invite')return NextResponse.redirect(new URL('/auth/accept-invite?error=invalid',request.url))
 const store=await cookies()
 const supabase=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{cookies:{getAll:()=>store.getAll(),setAll:(items)=>items.forEach(({name,value,options})=>store.set(name,value,options))}})
 const {error}=await supabase.auth.verifyOtp({token_hash,type:'invite'})
 if(error)destination.searchParams.set('error','expired')
 return NextResponse.redirect(destination)
}
