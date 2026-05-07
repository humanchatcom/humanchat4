/**
 * Listens for incoming call notifications via WebSocket
 * Shows IncomingCallModal when a call is received
 *
 * Also handles active-call events (CALL_DECLINED / CALL_ENDED /
 * CALL_TIMEOUT) so GlobalCallRoom no longer needs its own WebSocket.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import IncomingCallModal from './IncomingCallModal';
import { sessionStatusManager } from '../services/sessionStatusManager';
import { useCallContext } from '../context/CallContext';

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000';

interface CallRingingMessage {
  type: 'CALL_RINGING';
  callId: string;
  conversationId: string;
  caller: {
    userId: string;
    name: string;
    avatar?: string;
  };
  callType: 'video' | 'audio';
  initiatedAt: string;
}

export default function CallNotificationListener() {
  const [incomingCall, setIncomingCall] = useState<CallRingingMessage | null>(null);
  const { callId: activeCallId, endCall: endCallContext, participantName } = useCallContext();
  const router = useRouter();

  // Keep a mutable ref so the WS handler always sees the latest active callId
  // without needing to tear down / recreate the socket on every change.
  const activeCallIdRef = useRef<string | null>(null);
  const participantNameRef = useRef<string | null>(null);

  useEffect(() => {
    activeCallIdRef.current = activeCallId;
  }, [activeCallId]);

  useEffect(() => {
    participantNameRef.current = participantName;
  }, [participantName]);

  useEffect(() => {
    // Get current user ID from sessionStatusManager
    const userId = sessionStatusManager.getCurrentUserId();
    
    if (!userId) {
      console.log('[CallListener] No userId found, skipping WebSocket connection');
      return;
    }

    console.log('[CallListener] Connecting for user:', userId);

    // Connect to WebSocket for call notifications
    const ws = new WebSocket(`${WS_BASE_URL.replace(/\/$/, '')}/notifications/${userId}`);

    ws.onopen = () => {
      console.log('[CallListener] Connected to call notification WebSocket');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[CallListener] 📨 Received message:', message);

        if (message.type === 'CALL_RINGING') {
          console.log('[CallListener] 📞 INCOMING CALL from:', message.caller.name);
          setIncomingCall(message as CallRingingMessage);
          return;
        }

        // ── Active-call event handling (consolidated from GlobalCallRoom) ──
        const isActiveCallEvent =
          message.type === 'CALL_DECLINED' ||
          message.type === 'CALL_ENDED' ||
          message.type === 'CALL_TIMEOUT';

        if (isActiveCallEvent) {
          console.log('[CallListener] Call event:', message.type);

          // Clear any incoming-call modal
          setIncomingCall(null);

          // If this event targets the current active call, end it in context
          if (message.callId && message.callId === activeCallIdRef.current) {
            if (message.type === 'CALL_DECLINED') {
              const name = message.declinedBy?.name || participantNameRef.current || 'The other party';
              alert(`${name} is currently busy and unable to take your call.`);
            } else if (message.type === 'CALL_TIMEOUT') {
              const name = participantNameRef.current || 'The other party';
              alert(`${name} did not answer the call.`);
            }

            endCallContext();
            router.push('/chat');
          }
        }
      } catch (error) {
        console.error('[CallListener] Failed to parse WebSocket message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[CallListener] WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('[CallListener] WebSocket connection closed');
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Single socket for the session lifetime; refs track mutable state

  const handleDismiss = () => {
    setIncomingCall(null);
  };

  if (!incomingCall) {
    return null;
  }

  console.log('[CallListener] 🔔 Rendering IncomingCallModal for call:', incomingCall.callId);

  return (
    <IncomingCallModal
      callId={incomingCall.callId}
      caller={incomingCall.caller}
      callType={incomingCall.callType}
      onClose={handleDismiss}
    />
  );
}
