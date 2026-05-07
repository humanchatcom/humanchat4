'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { LiveKitRoom, RoomAudioRenderer, useRoomContext, useLocalParticipant } from '@livekit/components-react';
import { Room, RoomEvent } from 'livekit-client';
import { useCallContext } from '../context/CallContext';

// Component to bridge LiveKit media controls with CallContext
function MediaControlsBridge() {
  const { localParticipant } = useLocalParticipant();
  const { setMediaControls } = useCallContext();

  useEffect(() => {
    if (localParticipant) {
      // Provide media control functions to CallContext
      setMediaControls({
        toggleAudio: async () => {
          const isEnabled = localParticipant.isMicrophoneEnabled;
          await localParticipant.setMicrophoneEnabled(!isEnabled);
        },
        toggleVideo: async () => {
          const isEnabled = localParticipant.isCameraEnabled;
          await localParticipant.setCameraEnabled(!isEnabled);
        },
      });
    }

    // Cleanup when component unmounts
    return () => {
      setMediaControls(null);
    };
  }, [localParticipant, setMediaControls]);

  return null;
}

// Helper component to handle participant disconnect events
function ParticipantDisconnectHandler({ onRemoteDisconnect, onRemoteConnect }: { onRemoteDisconnect: () => void; onRemoteConnect: () => void }) {
  const room = useRoomContext();
  const hasCalledConnect = useRef(false);

  useEffect(() => {
    if (!room) return;

    // Check for existing remote participants
    const checkExistingParticipants = () => {
      if (hasCalledConnect.current) return;
      
      const remoteParticipants = Array.from(room.remoteParticipants.values());
      console.log('[ParticipantDisconnectHandler] Checking participants, found:', remoteParticipants.length);
      
      if (remoteParticipants.length > 0) {
        console.log('[ParticipantDisconnectHandler] Found existing remote participants, marking connected');
        hasCalledConnect.current = true;
        onRemoteConnect();
      }
    };

    // Check immediately and repeatedly with increasing delays
    checkExistingParticipants();
    const timer1 = setTimeout(checkExistingParticipants, 100);
    const timer2 = setTimeout(checkExistingParticipants, 500);
    const timer3 = setTimeout(checkExistingParticipants, 1000);

    const handleParticipantConnected = (participant: any) => {
      console.log('[ParticipantDisconnectHandler] Participant connected event:', participant.identity, 'isLocal:', participant.isLocal);
      // When remote participant joins, mark call as connected
      if (!participant.isLocal && !hasCalledConnect.current) {
        console.log('[ParticipantDisconnectHandler] Remote user joined, marking call connected');
        hasCalledConnect.current = true;
        onRemoteConnect();
      }
    };

    const handleParticipantDisconnected = (participant: any) => {
      console.log('[ParticipantDisconnectHandler] Participant disconnected:', participant.identity);
      // When remote participant leaves, end the call
      if (!participant.isLocal) {
        console.log('[ParticipantDisconnectHandler] Remote user left, ending call');
        onRemoteDisconnect();
      }
    };

    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    };
  }, [room, onRemoteDisconnect, onRemoteConnect]);

  return null;
}

interface CallShellProps {
  roomName: string;
  liveKitToken: string;
  children: React.ReactNode;
}

export default function CallShell({
  roomName,
  liveKitToken,
  children,
}: CallShellProps) {
  const router = useRouter();
  const { updateStatus, endCall, conversationId, updateConnectedAt, callId } = useCallContext();

  const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  const handleDisconnected = useCallback(async () => {
    console.log('[CallShell] Room disconnected');
    updateStatus('ending');
    
    // End call on backend
    if (callId) {
      try {
        const { endCall: endCallApi } = await import('../services/callApi');
        await endCallApi(callId);
        console.log('[CallShell] Call ended on backend');
      } catch (error) {
        console.error('[CallShell] Failed to end call on backend:', error);
        // Continue anyway to clean up local state
      }
    }
    
    // Small delay before clearing context and navigating
    setTimeout(() => {
      endCall();
      updateStatus('disconnected');
      
      // Navigate back to conversation
      const chatUrl = conversationId ? `/chat?conversationId=${conversationId}` : '/chat';
      router.push(chatUrl);
    }, 500);
  }, [updateStatus, endCall, conversationId, router, callId]);

  const handleConnected = useCallback(() => {
    console.log('[CallShell] Room connected (local only)');
    // Don't update status yet - wait for remote participant
  }, []);

  const handleRemoteConnected = useCallback(async () => {
    console.log('[CallShell] Remote participant joined - call is now connected');
    updateStatus('connected');
    updateConnectedAt(Date.now());
    
    // Mark call as connected in backend
    if (callId) {
      try {
        const { markCallConnected } = await import('../services/callApi');
        await markCallConnected(callId);
        console.log('[CallShell] Call marked as connected in backend');
      } catch (error) {
        console.error('[CallShell] Failed to mark call as connected:', error);
      }
    }
  }, [updateStatus, updateConnectedAt, callId]);

  const handleError = useCallback((error: Error) => {
    console.error('[CallShell] Room error:', error);
    updateStatus('failed');
  }, [updateStatus]);

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-[#0f1729] via-[#1a1f3a] to-[#0a0e1a]">
      <LiveKitRoom
        video={true}
        audio={true}
        token={liveKitToken}
        serverUrl={serverUrl}
        connect={true}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        onError={handleError}
        className="h-full w-full"
      >
        <RoomAudioRenderer />
        <MediaControlsBridge />
        <ParticipantDisconnectHandler 
          onRemoteDisconnect={handleDisconnected} 
          onRemoteConnect={handleRemoteConnected}
        />
        {children}
      </LiveKitRoom>
    </div>
  );
}