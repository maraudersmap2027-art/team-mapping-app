import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ChangeEvent } from 'react';
import { Camera, Mic, Radio, Send, Square } from 'lucide-react';
import { supabase } from './lib/supabase';

type Message = { id:string; sender_id:string; body:string|null; audio_path:string|null; created_at:string };

export default function TeamComms({teamId,userId}:{teamId:string;userId:string}) {
  const [items,setItems]=useState<Message[]>([]);
  const [draft,setDraft]=useState('');
  const [title,setTitle]=useState('');
  const [recording,setRecording]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [notice,setNotice]=useState('');
  const [audioUrls,setAudioUrls]=useState<Record<string,string>>({});
  const recorder=useRef<MediaRecorder|null>(null);
  const chunks=useRef<Blob[]>([]);

  async function load() {
    if(!supabase) return;
    const {data,error}=await supabase.from('messages').select('id,sender_id,body,audio_path,created_at').eq('team_id',teamId).order('created_at',{ascending:true}).limit(100);
    if(error) setNotice(error.message); else setItems((data??[]) as Message[]);
  }
  useEffect(()=>{
    void load();
    if(!supabase) return;
    const channel=supabase.channel('team-chat-'+teamId)
      .on('postgres_changes',{event:'*',schema:'public',table:'messages',filter:'team_id=eq.'+teamId},()=>void load())
      .subscribe();
    return ()=>{void supabase?.removeChannel(channel);};
  },[teamId]);

  async function send(event:FormEvent) {
    event.preventDefault();
    const body=draft.trim();
    if(!body||!supabase) return;
    setDraft('');
    const {error}=await supabase.from('messages').insert({team_id:teamId,sender_id:userId,body});
    if(error){setDraft(body);setNotice(error.message);}
  }

  async function voice() {
    if(recording){recorder.current?.stop();setRecording(false);return;}
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
        const sent=await supabase!.from('messages').insert({team_id:teamId,sender_id:userId,audio_path:path});
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
      const pos=await new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:15000}));
      const ext=file.name.split('.').pop()?.toLowerCase()||'jpg';
      const path=teamId+'/'+userId+'/'+crypto.randomUUID()+'.'+ext;
      const up=await supabase.storage.from('team-media').upload(path,file,{contentType:file.type});
      if(up.error)throw up.error;
      const result=await supabase.from('map_pins').insert({team_id:teamId,creator_id:userId,title:title.trim()||'Field photo '+new Date().toLocaleString(),image_path:path,latitude:pos.coords.latitude,longitude:pos.coords.longitude});
      if(result.error){await supabase.storage.from('team-media').remove([path]);throw result.error;}
      setTitle('');setNotice('Photo pin added to the map.');
    } catch(e){setNotice(e instanceof Error?e.message:'Could not create photo pin.');}
    finally{setUploading(false);event.target.value='';}
  }

  return <section className="comms-grid">
    <div className="chat-panel">
      <div className="chat-title"><div><span className="eyebrow">TEAM COMMS</span><h3>Messages & PTT</h3></div><span className="live-tag">LIVE</span></div>
      <div className="message-list">{items.map(m=><article className={m.sender_id===userId?'message mine':'message'} key={m.id}><small>{m.sender_id===userId?'You':'Team member'} · {new Date(m.created_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small>{m.body&&<p>{m.body}</p>}{m.audio_path&&<button className="voice-play" onClick={()=>void play(m)}><Radio size={15}/> Play voice message</button>}</article>)}{items.length===0&&<p className="empty-chat">No messages yet. Send the first team update.</p>}</div>
      <form className="chat-compose" onSubmit={send}><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Message your team…" aria-label="Message your team"/><button className="send-button" disabled={!draft.trim()} title="Send"><Send size={17}/></button><button type="button" className={recording?'record-button recording':'record-button'} onClick={()=>void voice()} disabled={uploading} title={recording?'Stop recording':'Record PTT voice note'}>{recording?<Square size={16}/>:<Mic size={17}/>}</button></form>
      <p className="chat-hint">{recording?'Recording — tap stop to send.':'Voice notes are shared with the whole team.'}</p>
    </div>
    <div className="photo-panel"><div><span className="eyebrow">MAP INTEL</span><h3>Drop a photo pin</h3><p className="chat-hint">Attach your current GPS position to a photo.</p></div><input className="photo-title" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Photo title (optional)" aria-label="Photo title"/><label className="photo-upload"><Camera size={17}/>{uploading?'Uploading…':'Take photo / choose image'}<input type="file" accept="image/*" capture="environment" onChange={photo} disabled={uploading}/></label>{notice&&<p className="notice">{notice}</p>}</div>
  </section>;
}
