import { useEffect, useState } from 'react';
import { getCurrentDevicePosition } from './lib/location';
import type { FormEvent } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Activity, Camera, Crosshair, LogIn, LogOut, MapPin, MessageCircle, Radio, Users } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import TeamComms from './TeamComms';

type Profile = { id: string; handle: string; status: 'active' | 'idle' | 'away' };
type Team = { id: string; name: string; invite_code: string };
type LocationRow = { user_id: string; latitude: number; longitude: number; updated_at: string; profiles?: Profile };
type Pin = { id: string; title: string; description: string | null; image_url: string | null; image_path?: string | null; latitude: number; longitude: number; created_at: string; creator_id: string };

const defaultCenter: [number, number] = [39.5, -98.35];
const markerIcon = L.divIcon({ className: 'team-marker', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] });

function Recenter({ position }: { position: [number, number] }) {
  const map = useMap();
  useEffect(() => { map.setView(position, Math.max(map.getZoom(), 13)); }, [map, position]);
  return null;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [teamName, setTeamName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [teamMembers, setTeamMembers] = useState<Profile[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<[number, number]>(defaultCenter);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || !supabase) { setProfile(null); setTeam(null); return; }
    let cancelled = false;
    (async () => {
      const { data: p } = await supabase!.from('profiles').select('id,handle,status').eq('id', session.user.id).maybeSingle();
      if (!cancelled && p) setProfile(p as Profile);
      const { data: membership } = await supabase!.from('team_members').select('team_id, teams(id,name,invite_code)').eq('user_id', session.user.id).limit(1).maybeSingle();
      if (!cancelled && membership?.teams) setTeam(membership.teams as unknown as Team);
    })();
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (!team || !supabase) return;
    let alive = true;
    const load = async () => {
      const [{ data: locs }, { data: photoPins }, { data: memberships }] = await Promise.all([
        supabase!.from('locations').select('user_id,latitude,longitude,updated_at').eq('team_id', team.id),
        supabase!.from('map_pins').select('*').eq('team_id', team.id).is('claimed_at', null).order('created_at', { ascending: false }),
        supabase!.from('team_members').select('user_id').eq('team_id', team.id),
      ]);
      const memberIds = (memberships ?? []).map(member => member.user_id);
      const { data: memberProfiles } = memberIds.length
        ? await supabase!.from('profiles').select('id,handle,status').in('id', memberIds)
        : { data: [] as Profile[] };
      if (alive) {
        setLocations((locs ?? []) as LocationRow[]);
        setTeamMembers((memberProfiles ?? []) as Profile[]);
        const hydratedPins = await Promise.all(((photoPins ?? []) as Pin[]).map(async pin => {
          if (!pin.image_path) return pin;
          const { data } = await supabase!.storage.from('team-media').createSignedUrl(pin.image_path, 3600);
          return { ...pin, image_url: data?.signedUrl ?? null };
        }));
        if (alive) setPins(hydratedPins);
      }
    };
    void load();
    const channel = supabase.channel('team-map-' + team.id, { config: { private: true } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'locations', filter: 'team_id=eq.' + team.id }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'map_pins', filter: 'team_id=eq.' + team.id }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => void load())
      .subscribe();
    return () => { alive = false; void supabase!.removeChannel(channel); };
  }, [team]);

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setNotice('');
    const result = authMode === 'signup'
      ? await supabase.auth.signUp({ email, password, options: { data: { handle: handle.trim() } } })
      : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    setNotice(result.error?.message ?? (authMode === 'signup' ? 'Account created. Check your email if confirmation is enabled.' : 'Signed in.'));
  }

  async function createTeam(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !session || !teamName.trim()) return;
    setBusy(true); setNotice('');
    const { data, error } = await supabase.rpc('create_team', { team_name: teamName.trim() });
    setBusy(false);
    if (error) setNotice(error.message);
    else { setTeam(data as Team); setNotice('Team created. Share its invite code with your members.'); }
  }

  async function joinTeam(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !inviteCode.trim()) return;
    setBusy(true); setNotice('');
    const { data, error } = await supabase.rpc('join_team', { code: inviteCode.trim().toUpperCase() });
    setBusy(false);
    if (error) setNotice(error.message);
    else { setTeam(data as Team); setNotice('You joined the team.'); }
  }

  async function updateStatus(status: Profile['status']) {
    if (!supabase || !profile) return;
    const { error } = await supabase.from('profiles').update({ status }).eq('id', profile.id);
    if (error) setNotice(error.message); else setProfile({ ...profile, status });
  }

  async function shareLocation() {
    setLocating(true); setNotice('');
    try {
      const p=await getCurrentDevicePosition({enableHighAccuracy:true,timeout:25000,maximumAge:10000});
      const next: [number, number] = [p.coords.latitude, p.coords.longitude];
      setPosition(next);
      if (supabase && team) {
        const { error } = await supabase.from('locations').upsert({
          team_id: team.id, user_id: session!.user.id,
          latitude: next[0], longitude: next[1], updated_at: new Date().toISOString(),
        });
        setNotice(error ? error.message : 'Your location was shared with your team.');
      } else setNotice('Location acquired.');
    } catch(error) {
      setNotice(error instanceof Error ? error.message : 'Could not get your location.');
    } finally { setLocating(false); }
  }

  async function claimPin(pinId: string) {
    if (!supabase) return;
    setNotice('Checking your location…');
    try {
      const p=await getCurrentDevicePosition({enableHighAccuracy:true,timeout:25000,maximumAge:0});
      const { data, error } = await supabase.rpc('claim_map_pin', {
        target_pin: pinId, claimant_lat: p.coords.latitude, claimant_lon: p.coords.longitude,
      });
      if (error) setNotice(error.message);
      else if (data) { setPins(current => current.filter(pin => pin.id !== pinId)); setNotice('Pin claimed and removed from the live map.'); }
      else setNotice('You must be within 75 metres of the pin to claim it.');
    } catch(error) {
      setNotice(error instanceof Error ? error.message : 'Could not get your location.');
    }
  }

  async function deletePin(pinId: string) {
    if (!supabase || !session) return;
    if (!window.confirm('Delete this photo pin? This cannot be undone.')) return;
    const { error } = await supabase.from('map_pins').delete()
      .eq('id', pinId).eq('creator_id', session.user.id).is('claimed_at', null);
    if (error) setNotice('Could not delete pin: ' + error.message);
    else {
      setPins(current => current.filter(pin => pin.id !== pinId));
      setNotice('Your photo pin was deleted.');
    }
  }

  async function copyInviteCode() {
    if (!team?.invite_code) return;
    try {
      await navigator.clipboard.writeText(team.invite_code);
      setNotice('Invite code copied. Share it with your second account.');
    } catch {
      setNotice('Your invite code is shown below. Press and hold it to copy.');
    }
  }

  async function signOut() { await supabase?.auth.signOut(); setTeam(null); }

  if (!isSupabaseConfigured) return <main className="setup-screen"><div className="setup-card"><div className="brand-mark"><MapPin /></div><p className="eyebrow">TEAM MAPPING PLATFORM</p><h1>Connect your project</h1><p>The app foundation is in place. Add your Supabase project URL and publishable key as deployment environment variables to activate sign-in, teams, and live data.</p><div className="setup-code">VITE_SUPABASE_URL<br/>VITE_SUPABASE_PUBLISHABLE_KEY</div><p className="muted">Do not add a service-role key here. It must never be exposed in a browser app.</p></div></main>;

  if (!session) return <main className="auth-screen"><form className="auth-card" onSubmit={authenticate}><div className="brand-mark"><MapPin /></div><p className="eyebrow">TEAM MAPPING PLATFORM</p><h1>{authMode === 'signin' ? 'Welcome back' : 'Create your account'}</h1><p className="muted">Your team, together on one live map.</p>{authMode === 'signup' && <label>Team handle<input value={handle} onChange={e => setHandle(e.target.value)} required minLength={2} placeholder="e.g. trailrunner" /></label>}<label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></label><label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} /></label><button className="primary wide" disabled={busy}><LogIn size={17}/>{busy ? 'Please wait…' : authMode === 'signin' ? 'Sign in' : 'Create account'}</button><button type="button" className="text-button" onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}>{authMode === 'signin' ? 'New here? Create an account' : 'Already registered? Sign in'}</button>{notice && <p className="notice">{notice}</p>}</form></main>;

  if (!team) return <main className="auth-screen"><section className="auth-card"><div className="brand-mark"><Users /></div><p className="eyebrow">YOUR TEAM SPACE</p><h1>Get your team together</h1><p className="muted">Create a new team or join one with an invite code.</p><form onSubmit={createTeam}><label>New team name<input value={teamName} onChange={e => setTeamName(e.target.value)} placeholder="Search and Rescue Team" required /></label><button className="primary wide" disabled={busy}>Create team</button></form><div className="or-divider"><span>OR JOIN A TEAM</span></div><form onSubmit={joinTeam}><label>Invite code<input value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="TEAM CODE" required /></label><button className="secondary wide" disabled={busy}>Join team</button></form><button className="text-button" onClick={signOut}>Sign out</button>{notice && <p className="notice">{notice}</p>}</section></main>;

  return <main className="app-shell"><header className="topbar"><div className="brand"><div className="brand-mark small"><MapPin /></div><div><strong>FIELDLINK</strong><span>{team.name}</span></div></div><div className="top-actions"><span className="status-dot"/><span className="online-label">Connected</span><button className="icon-button" title="Sign out" onClick={signOut}><LogOut size={18}/></button></div></header><section className="map-wrap"><MapContainer center={position} zoom={5} zoomControl={false} className="map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Recenter position={position}/>{locations.map(loc => <Marker key={loc.user_id} position={[loc.latitude,loc.longitude]} icon={markerIcon}><Popup><div className="member-popup"><strong>{teamMembers.find(member => member.id === loc.user_id)?.handle ?? (loc.user_id === session.user.id ? profile?.handle ?? 'You' : 'Team member')}</strong><span className={'status-chip ' + (teamMembers.find(member => member.id === loc.user_id)?.status ?? 'active')}>{teamMembers.find(member => member.id === loc.user_id)?.status ?? 'active'}</span><small>Last shared: {new Date(loc.updated_at).toLocaleString()}</small></div></Popup></Marker>)}{pins.map(pin => <Marker key={pin.id} position={[pin.latitude,pin.longitude]}><Popup><strong>{pin.title}</strong><br/>{pin.description}<br/><small>{new Date(pin.created_at).toLocaleString()}</small>{pin.image_url && <img className="popup-image" src={pin.image_url} alt={pin.title}/>}<br/><button className="pin-claim" onClick={() => void claimPin(pin.id)}>Check location & claim</button>{pin.creator_id === session.user.id && <button className="pin-delete" onClick={() => void deletePin(pin.id)}>Delete my pin</button>}</Popup></Marker>)}</MapContainer><div className="map-heading"><span className="live-pill"><span/> LIVE TEAM MAP</span><h2>{team.name}</h2><p>{locations.length} shared location{locations.length === 1 ? '' : 's'}</p></div><button className="locate-button" onClick={shareLocation} disabled={locating} title="Share my location"><Crosshair size={20}/><span>{locating ? 'Locating…' : 'Share location'}</span></button></section><section className="dashboard"><div className="section-heading"><div><p className="eyebrow">TEAM STATUS</p><h2>Field overview</h2></div><button className="status-select" onClick={() => updateStatus(profile?.status === 'active' ? 'away' : profile?.status === 'away' ? 'idle' : 'active')}><Activity size={15}/>{profile?.status ?? 'active'} <span>Change</span></button></div><div className="stats-grid"><article className="stat-card"><Users/><strong>{locations.length}</strong><span>Locations shared</span></article><article className="stat-card"><MapPin/><strong>{pins.length}</strong><span>Unclaimed pins</span></article><article className="stat-card"><Radio/><strong>PTT</strong><span>Voice messaging</span></article></div><section className="members-panel"><div className="chat-title"><div><p className="eyebrow">YOUR CREW</p><h3>Team members <span className="member-count">{teamMembers.length}</span></h3></div><span className="live-tag">LIVE</span></div><div className="member-grid">{teamMembers.map(member => { const shared = locations.find(loc => loc.user_id === member.id); return <article className="member-card" key={member.id}><span className="member-avatar"><Users size={18}/></span><span className="member-info"><strong>{member.handle}{member.id === session.user.id ? ' (you)' : ''}</strong><small>{shared ? 'Location shared ' + new Date(shared.updated_at).toLocaleString() : 'No location shared yet'}</small></span><span className={'status-chip ' + member.status}>{member.status}</span></article>; })}</div></section><div className="feature-list"><div className="feature-row"><span className="feature-icon"><MessageCircle/></span><span><strong>Team messages</strong><small>Realtime text chat and push-to-talk voice notes</small></span><span className="coming">LIVE</span></div><div className="feature-row"><span className="feature-icon"><Camera/></span><span><strong>Photo pins</strong><small>Geotagged image uploads</small></span><span className="coming">LIVE</span></div></div><section className="invite-panel"><div><p className="eyebrow">INVITE YOUR TEAM</p><strong>Team invite code</strong><p className="invite-help">Enter this code on your second account's Join a Team screen.</p></div><code className="invite-code">{team.invite_code}</code><button className="secondary invite-copy" onClick={() => void copyInviteCode()}>Copy invite code</button></section><TeamComms teamId={team.id} userId={session.user.id}/>{notice && <p className="notice toast">{notice}</p>}<footer>Signed in as <strong>{profile?.handle ?? session.user.email}</strong><span>•</span><button onClick={signOut}>Sign out</button></footer></section></main>;
}
