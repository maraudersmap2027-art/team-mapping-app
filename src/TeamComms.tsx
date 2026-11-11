import { useEffect, useRef, useState } from 'react';
import { getCurrentDevicePosition } from './lib/location';
import type { FormEvent, ChangeEvent } from 'react';
import { Camera, Mic, Radio, Send, Square, Users } from 'lucide-react';
import { supabase } from './lib/supabase';
import LivePTT from './LivePTT';

type Message = { id:string; sender_id:string; recipient_id:string|null; body:string|null; audio_path:string|null; created_at:string };
type Member = { id:string; handle:string; status:string };

export default function TeamComms({teamId,userId}:{teamId:string;userId:string}) {
  const [items,setItems]=useState<Message[]>([]);
  const [members,setMembers]=useState<Member[]>([]);
  const [recipientId,setRecipientId]=useState('');
  const [mode,setMode]=useState<'team'|'direct'>('team');
  const [draft,setDraft]=useState('');
  const [title,setTitle]=useState('');
  const [aiTitle,setAiTitle]=useState('');
  const [recording,setRecording]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [notice,setNotice]=useState('');
  const [audioUrls,setAudioUrls]=useState<Record<string,string>>({});
  const recorder=useRef<MediaRecorder|null>(null);
  const chunks=useRef<Blob[]>([]);
  const recipient=mode==='direct' ? recipientId : null;

  async function load() {
    if(!supabase) return;
    if(mode==='direct'&&!recipientId){setItems([]);return;}
    let query=supabase.from('messages').select('id,sender_id,recipient_id,body,audio_path,created_at').eq('team_id',teamId);
    if(recipient) query=query.or('and(sender_id.eq.'+userId+',recipient_id.eq.'+recipient+'),and(sender_id.eq.'+recipient+',recipient_id.eq.'+userId+')');
    else query=query.is('recipient_id',null);
    const {data,error}=await query.order('created_at',{ascending:true}).limit(100);
    if(error) setNotice(error.message); else setItems((data??[]) as Message[]);
  }

  useEffect(()=>{
    if(!supabase) return;
    let active=true;
    (async()=>{
      const {data:links,error}=await supabase!.from('team_members').select('user_id').eq('team_id',teamId);
      if(error){setNotice(error.message);return;}
      const ids=(links??[]).map(row=>row.user_id).filter(id=>id!==userId);
      if(!ids.length){if(active)setMembers([]);return;}
      const {data:profiles, error:profileError}=await supabase!.from('profiles').select('id,handle,status').in('id',ids).order('handle');
      if(profileError){setNotice(profileError.message);return;}
      if(active)setMembers((profiles??[]) as Member[]);
    })();
    return ()=>{active=false;};
  },[teamId,userId]);

  useEffect(()=>{
    void load();
    if(!supabase) return;
    const channel=supabase.channel('team-chat-'+teamId)
      .on('postgres_changes',{event:'*',schema:'public',table:'messages',filter:'team_id=eq.'+teamId},()=>void load())
      .subscribe();
    return ()=>{void supabase?.removeChannel(channel);};
  },[teamId,userId,recipientId,mode]);

  async function send(event:FormEvent) {
    event.preventDefault();
    const body=draft.trim();
    if(!body||!supabase) return;
    if(mode==='direct'&&!recipientId){setNotice('Choose a teammate first.');return;}
    setDraft('');
    const {error}=await supabase.from('messages').insert({team_id:teamId,sender_id:userId,recipient_id:recipient,body});
    if(error){setDraft(body);setNotice(error.message);}
  }

  async function voice() {
    if(recording){recorder.current?.stop();setRecording(false);return;}
    if(mode==='direct'&&!recipientId){setNotice('Choose a teammate before recording a private voice message.');return;}
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setNotice('Voice recording is not supported by this browser.');return;}
    if(!supabase) return;
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const r=new MediaRecorder(stream); chunks.current=[];
      r.ondataavailable=e=>{if(e.data.size) chunks.current.push(e.data);};
      r.onstop=async()=>{
        stream.getTracks().forEach(t=>t.stop());
        const blob=new Blob(chunks.current,{type:r.mimeType||'audio/webm'});
        if(!blob.size) return;
        setUploading(true);
        const ext=blob.type.includes('mp4')?'m4a':'webm';
        const path=teamId+'/'+userId+'/'+crypto.randomUUID()+'.'+ext;
        const up=await supabase!.storage.from('team-media').upload(path,blob,{contentType:blob.type});
        if(up.error){setNotice(up.error.message);setUploading(false);return;}
        const sent=await supabase!.from('messages').insert({team_id:teamId,sender_id:userId,recipient_id:recipient,audio_path:path});
        if(sent.error){await supabase!.storage.from('team-media').remove([path]);setNotice(sent.error.message);}
        setUploading(false);
      };
      recorder.current=r;r.start();setRecording(true);setNotice('');
    } catch(e){setNotice(e instanceof Error?e.message:'Microphone permission was denied.');}
  }

  async function play(item:Message) {
    if(!supabase||!item.audio_path) return;
    let url=audioUrls[item.id];
    if(!url){const {data,error}=await supabase.storage.from('team-media').createSignedUrl(item.audio_path,300);if(error||!data){setNotice(error?.message||'Audio unavailable.');return;}url=data.signedUrl;setAudioUrls(old=>({...old,[item.id]:url}));}
    void new Audio(url).play();
  }

  async function photo(event:ChangeEvent<HTMLInputElement>) {
    const file=event.target.files?.[0];if(!file||!supabase)return;
    if(!file.type.startsWith('image/')){setNotice('Choose an image file.');return;}
    setUploading(true);setNotice('');
    try {
      const position=await getCurrentDevicePosition({enableHighAccuracy:true,timeout:25000,maximumAge:0});
      const latitude=position.coords.latitude;
      const longitude=position.coords.longitude;
      setAiTitle('Preparing photo…');
      const resized = await new Promise<{blob:Blob; data:string}>((resolve,reject)=>{
        const image = new Image(); const objectUrl = URL.createObjectURL(file);
        image.onload = () => {
          const scale = Math.min(1, 1280 / Math.max(image.width,image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1,Math.round(image.width*scale)); canvas.height = Math.max(1,Math.round(image.height*scale));
          const ctx = canvas.getContext('2d');
          if(!ctx){URL.revokeObjectURL(objectUrl);reject(new Error('Could not process this image.'));return;}
          ctx.drawImage(image,0,0,canvas.width,canvas.height);
          canvas.toBlob(blob=>{
            URL.revokeObjectURL(objectUrl); if(!blob){reject(new Error('Could not compress this image.'));return;}
            const reader=new FileReader(); reader.onload=()=>resolve({blob,data:String(reader.result).split(',')[1]});
            reader.onerror=()=>reject(new Error('Could not prepare image for AI.')); reader.readAsDataURL(blob);
          },'image/jpeg',0.82);
        };
        image.onerror=()=>{URL.revokeObjectURL(objectUrl);reject(new Error('Could not read this image.'));}; image.src=objectUrl;
      });
      setAiTitle('Analyzing photo with AI…');
      let aiTimer: number | undefined;
      const ai = await Promise.race([
        supabase.functions.invoke('title-photo',{body:{imageBase64:resized.data,mimeType:'image/jpeg'}}),
        new Promise<{data:null;error:Error}>(resolve=>{
          aiTimer=window.setTimeout(()=>resolve({data:null,error:new Error('AI title request timed out after 20 seconds')}),20000);
        })
      ]);
      if(aiTimer!==undefined) window.clearTimeout(aiTimer);
      const generated = typeof ai.data?.title==='string' ? ai.data.title.trim() : '';
      const finalTitle = title.trim() || generated || 'Field photo '+new Date().toLocaleString();
      const path=teamId+'/'+userId+'/'+crypto.randomUUID()+'.jpg';
      const up=await supabase.storage.from('team-media').upload(path,resized.blob,{contentType:'image/jpeg'});
      if(up.error)throw up.error;
      const result=await supabase.from('map_pins').insert({team_id:teamId,creator_id:userId,title:finalTitle,description:generated ? 'AI-generated photo title' : null,image_path:path,latitude,longitude});
      if(result.error){await supabase.storage.from('team-media').remove([path]);throw result.error;}
      setTitle('');setAiTitle('');
      setNotice(generated ? 'AI titled your photo: '+finalTitle+'. Photo pin added to the map.' : 'Photo pin added. AI title unavailable; used a fallback title.');
      if(ai.error) console.warn('AI title generation unavailable:',ai.error.message);
    } catch(e){
      const message=e instanceof Error ? e.message : 'Could not create photo pin. Please try again.';
      setNotice(message);
    } finally {
      setUploading(false);setAiTitle('');event.target.value='';
    }
  }

  const activeMember=members.find(member=>member.id===recipientId);
  return <section className="comms-grid">
    <div className="chat-panel">
      <div className="chat-title"><div><span className="eyebrow">TEAM COMMS</span><h3>Messages & PTT</h3></div><span className="live-tag">LIVE</span></div>
      <div className="chat-modes" role="group" aria-label="Conversation type">
        <button type="button" className={mode==='team'?'active':''} onClick={()=>{setMode('team');setNotice('');}}><Users size={15}/> Team chat</button>
        <button type="button" className={mode==='direct'?'active':''} onClick={()=>{setMode('direct');setNotice('');}}><Radio size={15}/> Direct</button>
      </div>
      {mode==='direct'&&<label className="recipient-picker">Private conversation
        <select value={recipientId} onChange={e=>setRecipientId(e.target.value)}>
          <option value="">Choose a teammate…</option>
          {members.map(member=><option key={member.id} value={member.id}>{member.handle} · {member.status}</option>)}
        </select>
      </label>}
      <div className="conversation-label">{mode==='team'?'Messages for the whole team':activeMember?'Private chat with '+activeMember.handle:'Select a teammate to start a private chat'}</div>
      <div className="message-list">{items.map(m=><article className={m.sender_id===userId?'message mine':'message'} key={m.id}><small>{m.sender_id===userId?'You':mode==='direct'?activeMember?.handle??'Teammate':'Team member'} · {new Date(m.created_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small>{m.body&&<p>{m.body}</p>}{m.audio_path&&<button className="voice-play" onClick={()=>void play(m)}><Radio size={15}/> Play voice message</button>}</article>)}{items.length===0&&<p className="empty-chat">{mode==='direct'&&!recipientId?'Choose a teammate above to view your private conversation.':'No messages yet. Send the first update.'}</p>}</div>
      <form className="chat-compose" onSubmit={send}><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder={mode==='direct'?'Private message…':'Message your team…'} aria-label="Message" disabled={mode==='direct'&&!recipientId}/><button className="send-button" disabled={!draft.trim()||(mode==='direct'&&!recipientId)} title="Send"><Send size={17}/></button><button type="button" className={recording?'record-button recording':'record-button'} onClick={()=>void voice()} disabled={uploading||(mode==='direct'&&!recipientId)} title={recording?'Stop recording':'Record voice message'}>{recording?<Square size={16}/>:<Mic size={17}/>}</button></form>
      <p className="chat-hint">{recording?'Recording — tap stop to send.':mode==='direct'?'Private text and recorded voice messages are visible only to you and the selected teammate.':'Team text and voice messages are visible to all team members.'}</p>
      {mode==='direct'&&recipientId&&activeMember&&<LivePTT teamId={teamId} userId={userId} recipientId={recipientId} recipientHandle={activeMember.handle}/>}
      {notice&&<p className="notice">{notice}</p>}
    </div>
    <div className="photo-panel"><div><span className="eyebrow">MAP INTEL</span><h3>Drop a photo pin</h3><p className="chat-hint">AI identifies the main subject and creates a concise map title, then attaches your GPS position.</p></div><input className="photo-title" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Photo title (optional)" aria-label="Photo title"/><label className="photo-upload"><Camera size={17}/>{uploading?(aiTitle||'Uploading…'):'Take photo / choose image'}<input type="file" accept="image/*" capture="environment" onChange={photo} disabled={uploading}/></label></div>
  </section>;
}
