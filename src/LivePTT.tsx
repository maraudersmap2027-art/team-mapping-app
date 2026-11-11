import { useEffect, useRef, useState } from 'react';
import { Mic, Radio, Volume2 } from 'lucide-react';
import { supabase } from './lib/supabase';

type Signal = {
  kind: 'offer' | 'answer' | 'ice' | 'stop' | 'busy';
  from: string;
  to: string;
  callId: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export default function LivePTT({ teamId, userId, recipientId, recipientHandle }: {
  teamId: string;
  userId: string;
  recipientId: string;
  recipientHandle: string;
}) {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Connecting private radio…');
  const [receiving, setReceiving] = useState(false);
  const [needsAudioTap, setNeedsAudioTap] = useState(false);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const callIdRef = useRef('');
  const ownerRef = useRef<'caller' | 'receiver' | null>(null);
  const pendingIceRef = useRef<Array<{ callId: string; candidate: RTCIceCandidateInit }>>([]);
  const mountedRef = useRef(true);
  const holdingRef = useRef(false);

  function closePeer() {
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    pendingIceRef.current = [];
    callIdRef.current = '';
    ownerRef.current = null;
    setReceiving(false);
    setNeedsAudioTap(false);
  }

  async function signal(payload: Signal) {
    const channel = channelRef.current;
    if (!channel) throw new Error('Private radio is not connected.');
    const result = await channel.send({ type: 'broadcast', event: 'ptt-signal', payload });
    if (result !== 'ok') throw new Error('Could not send radio signal. Check your connection.');
  }

  function createPeer(callId: string) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    peerRef.current = pc;
    pc.onicecandidate = event => {
      if (event.candidate) {
        void signal({
          kind: 'ice', from: userId, to: recipientId, callId,
          candidate: event.candidate.toJSON(),
        }).catch(error => setStatus(error instanceof Error ? error.message : 'Radio connection error.'));
      }
    };
    pc.ontrack = event => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.srcObject = event.streams[0];
      setReceiving(true);
      void audio.play().then(() => setNeedsAudioTap(false)).catch(() => {
        setNeedsAudioTap(true);
        setStatus('Incoming voice — tap Enable audio.');
      });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setStatus(ownerRef.current === 'receiver' ? 'Receiving live audio' : 'Radio connected — hold to speak');
      if (pc.connectionState === 'failed') setStatus('Direct audio connection failed. This network may require a TURN relay.');
      if (pc.connectionState === 'disconnected') setStatus('Radio connection interrupted.');
    };
    return pc;
  }

  async function flushIce(pc: RTCPeerConnection, callId: string) {
    const queued = pendingIceRef.current.filter(item => item.callId === callId);
    pendingIceRef.current = pendingIceRef.current.filter(item => item.callId !== callId);
    for (const item of queued) await pc.addIceCandidate(item.candidate);
  }

  async function handleSignal(signalPayload: Signal) {
    const message = signalPayload;
    if (!message || message.to !== userId || message.from !== recipientId) return;

    if (message.kind === 'offer' && message.sdp) {
      if (peerRef.current && peerRef.current.connectionState !== 'closed') {
        await signal({ kind: 'busy', from: userId, to: recipientId, callId: message.callId });
        return;
      }
      if (peerRef.current) closePeer();
      callIdRef.current = message.callId;
      ownerRef.current = 'receiver';
      setStatus('Incoming radio call…');
      const pc = createPeer(message.callId);
      await pc.setRemoteDescription(message.sdp);
      await flushIce(pc, message.callId);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await signal({
        kind: 'answer', from: userId, to: recipientId, callId: message.callId,
        sdp: pc.localDescription ?? answer,
      });
      setStatus('Connected — listening');
      return;
    }

    if (message.kind === 'ice' && message.candidate) {
      const pc = peerRef.current;
      if (!pc) {
        pendingIceRef.current.push({ callId: message.callId, candidate: message.candidate });
        return;
      }
      if (message.callId !== callIdRef.current) return;
      if (pc.remoteDescription) await pc.addIceCandidate(message.candidate);
      else pendingIceRef.current.push({ callId: message.callId, candidate: message.candidate });
      return;
    }

    if (message.callId !== callIdRef.current) return;
    if (message.kind === 'answer' && message.sdp && ownerRef.current === 'caller') {
      const pc = peerRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(message.sdp);
      await flushIce(pc, message.callId);
      setStatus('Radio connected — hold to speak');
    } else if (message.kind === 'stop') {
      closePeer();
      setStatus('Teammate released the radio.');
    } else if (message.kind === 'busy') {
      closePeer();
      setStatus('Teammate is already on the radio.');
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    if (!supabase || !recipientId) return;
    let cancelled = false;
    const ids = [userId, recipientId].sort();
    const topic = 'ptt:' + teamId + ':' + ids.join(':');
    void (async () => {
      try {
        await supabase!.realtime.setAuth();
        if (cancelled) return;
        const channel = supabase!.channel(topic, { config: { private: true, broadcast: { self: false } } });
        channelRef.current = channel;
        channel.on('broadcast', { event: 'ptt-signal' }, event => {
          void handleSignal(event.payload as Signal).catch(error => {
            setStatus(error instanceof Error ? error.message : 'Radio signaling failed.');
            closePeer();
          });
        }).subscribe((state, error) => {
          if (cancelled || !mountedRef.current) return;
          if (state === 'SUBSCRIBED') {
            setConnected(true);
            setStatus('Private radio ready — both teammates must open this chat.');
          } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
            setConnected(false);
            setStatus(error?.message || 'Private radio unavailable. Check channel authorization.');
          }
        });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not connect private radio.');
      }
    })();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      setConnected(false);
      closePeer();
      const channel = channelRef.current;
      channelRef.current = null;
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, [teamId, userId, recipientId]);

  async function startTalking() {
    if (!connected || !supabase || !channelRef.current) {
      setStatus('Private radio is still connecting.');
      return;
    }
    if (peerRef.current && peerRef.current.connectionState !== 'closed') return;
    try {
      setStatus('Requesting microphone…');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const callId = crypto.randomUUID();
      callIdRef.current = callId;
      ownerRef.current = 'caller';
      const pc = createPeer(callId);
      stream.getAudioTracks().forEach(track => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await signal({
        kind: 'offer', from: userId, to: recipientId, callId,
        sdp: pc.localDescription ?? offer,
      });
      setStatus('Calling ' + recipientHandle + ' — hold to talk');
      if (!holdingRef.current) await stopTalking();
    } catch (error) {
      closePeer();
      setStatus(error instanceof Error ? error.message : 'Could not start push-to-talk.');
    }
  }

  async function stopTalking() {
    const callId = callIdRef.current;
    if (!callId) return;
    if (ownerRef.current !== 'caller') return;
    try { await signal({ kind: 'stop', from: userId, to: recipientId, callId }); } catch { /* connection may already be gone */ }
    closePeer();
    setStatus('Radio ready.');
  }

  async function enableAudio() {
    if (!audioRef.current) return;
    try {
      await audioRef.current.play();
      setNeedsAudioTap(false);
      setStatus('Receiving live audio');
    } catch {
      setStatus('Could not enable speaker audio.');
    }
  }

  return <div className="live-ptt">
    <audio ref={audioRef} autoPlay playsInline />
    <button
      type="button"
      className={receiving ? 'ptt-hold receiving' : 'ptt-hold'}
      disabled={!connected}
      onPointerDown={event => {
        event.preventDefault();
        holdingRef.current = true;
        if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId);
        void startTalking();
      }}
      onPointerUp={event => {
        holdingRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        void stopTalking();
      }}
      onPointerCancel={() => { holdingRef.current = false; void stopTalking(); }}
      onContextMenu={event => event.preventDefault()}
    >
      <Mic size={18} />
      <span>HOLD TO TALK</span>
      <Radio size={16} />
    </button>
    <span className="ptt-status">{status}</span>
    {needsAudioTap && <button type="button" className="ptt-audio" onClick={() => void enableAudio()}><Volume2 size={14}/> Enable audio</button>}
  </div>;
}
