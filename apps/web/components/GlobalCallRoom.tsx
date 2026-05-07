'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCallContext } from '../context/CallContext';
import CallShell from './CallShell';
import AudioCallPage from './AudioCallPage';
import VideoCallPage from './VideoCallPage';
import { useCallSounds } from '../hooks/useCallSounds';

/**
 * GlobalCallRoom - Mounts LiveKit room globally when a call is active.
 *
 * All call data (roomName, liveKitToken, isHost, etc.) is read from
 * CallContext — set by the /call/[callId] page. This avoids a redundant
 * getCall() fetch (which would generate a second token with a different
 * identity) and eliminates the duplicate WebSocket that previously existed
 * here.  Active-call event handling (CALL_DECLINED / CALL_ENDED /
 * CALL_TIMEOUT) now lives in CallNotificationListener.
 */
export default function GlobalCallRoom() {
  const {
    callId,
    callType,
    isMinimized,
    endCall: endCallContext,
    status,
    roomName,
    liveKitToken,
    isHost,
    conversationId,
  } = useCallContext();

  const router = useRouter();
  const { play: playSound, stop: stopSound } = useCallSounds();

  // ── Outgoing ring / call-end sounds ──────────────────────────────
  useEffect(() => {
    if (!callId) return;

    // Play outgoing ring when the caller is waiting for the other party
    if (status === 'connecting' && isHost) {
      console.log('[GlobalCallRoom] 🔊 Playing outgoing ring for caller');
      playSound('outgoing-ring');
    }

    // Stop ring when the call resolves
    if (status === 'connected' || status === 'disconnected' || status === 'failed') {
      stopSound('outgoing-ring');

      if (status === 'disconnected' || status === 'failed') {
        console.log('[GlobalCallRoom] 🔊 Playing call-end sound');
        playSound('call-end');
      }
    }

    return () => {
      stopSound('outgoing-ring');
    };
  }, [callId, status, isHost, playSound, stopSound]);

  // ── End call handler ─────────────────────────────────────────────
  const handleEndCall = useCallback(async () => {
    console.log('[GlobalCallRoom] 🔊 Playing call-end sound (user ended call)');
    playSound('call-end');

    try {
      const { endCall: endCallApi } = await import('../services/callApi');
      await endCallApi(callId!);
    } catch (err) {
      console.error('[GlobalCallRoom] Failed to end call:', err);
    } finally {
      endCallContext();
      const chatUrl = conversationId
        ? `/chat?conversationId=${conversationId}`
        : '/chat';
      router.push(chatUrl);
    }
  }, [callId, endCallContext, conversationId, router, playSound]);

  // ── Render nothing when there is no active call data ─────────────
  if (!callId || !roomName || !liveKitToken) {
    return null;
  }

  const shouldShowCallUI = !isMinimized;

  return (
    <div
      className={`fixed inset-0 z-[9999] ${
        shouldShowCallUI ? 'block' : 'hidden'
      }`}
    >
      <CallShell roomName={roomName} liveKitToken={liveKitToken}>
        {callType === 'audio' ? (
          <AudioCallPage onEndCall={handleEndCall} />
        ) : (
          <VideoCallPage onEndCall={handleEndCall} />
        )}
      </CallShell>
    </div>
  );
}
