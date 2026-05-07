'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useCallSounds } from '../hooks/useCallSounds';

export type CallType = 'audio' | 'video';
export type CallStatus = 'connecting' | 'connected' | 'ending' | 'disconnected' | 'failed';

export interface MediaControls {
  toggleAudio: () => Promise<void>;
  toggleVideo: () => Promise<void>;
}

interface CallContextValue {
  // Call metadata
  callId: string | null;
  callType: CallType | null;
  conversationId: string | null;
  participantName: string | null;
  participantAvatar: string | null;
  returnUrl: string | null;
  roomName: string | null;
  liveKitToken: string | null;
  isHost: boolean;
  
  // Call state
  status: CallStatus;
  isMinimized: boolean;
  connectedAt: number | null;
  
  // Media state
  isMuted: boolean;
  isCameraOff: boolean;
  isSpeakerOn: boolean;
  isScreenSharing: boolean;
  
  // Actions
  startCall: (params: StartCallParams) => void;
  endCall: () => void;
  toggleMinimize: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleSpeaker: () => void;
  toggleScreenShare: () => void;
  updateStatus: (status: CallStatus) => void;
  updateConnectedAt: (timestamp: number) => void;
  
  // Media control functions (provided by LiveKit room)
  setMediaControls: (controls: MediaControls | null) => void;
}

interface StartCallParams {
  callId: string;
  callType: CallType;
  conversationId: string;
  participantName: string;
  participantAvatar?: string;
  returnUrl: string;
  roomName: string;
  liveKitToken: string;
  isHost?: boolean;
}

const CallContext = createContext<CallContextValue | undefined>(undefined);

export function CallProvider({ children }: { children: React.ReactNode }) {
  const [callId, setCallId] = useState<string | null>(null);
  const [callType, setCallType] = useState<CallType | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [participantName, setParticipantName] = useState<string | null>(null);
  const [participantAvatar, setParticipantAvatar] = useState<string | null>(null);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [liveKitToken, setLiveKitToken] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  
  const [status, setStatus] = useState<CallStatus>('disconnected');
  const [isMinimized, setIsMinimized] = useState(false);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  
  // Store media control functions from LiveKit room
  const [mediaControls, setMediaControls] = useState<MediaControls | null>(null);
  
  // Call sounds for mute/unmute feedback
  const { play: playSound } = useCallSounds();

  const startCall = useCallback((params: StartCallParams) => {
    setCallId(params.callId);
    setCallType(params.callType);
    setConversationId(params.conversationId);
    setParticipantName(params.participantName);
    setParticipantAvatar(params.participantAvatar || null);
    setReturnUrl(params.returnUrl);
    setRoomName(params.roomName);
    setLiveKitToken(params.liveKitToken);
    setIsHost(params.isHost ?? false);
    setStatus('connecting');
    setConnectedAt(null);
    setIsMinimized(false);
  }, []);

  const endCall = useCallback(() => {
    setCallId(null);
    setCallType(null);
    setConversationId(null);
    setParticipantName(null);
    setParticipantAvatar(null);
    setReturnUrl(null);
    setRoomName(null);
    setLiveKitToken(null);
    setIsHost(false);
    setStatus('disconnected');
    setConnectedAt(null);
    setIsMinimized(false);
    setIsMuted(false);
    setIsCameraOff(false);
    setIsScreenSharing(false);
  }, []);

  const toggleMinimize = useCallback(() => {
    setIsMinimized(prev => !prev);
  }, []);

  const toggleMute = useCallback(() => {
    // If we have media controls from LiveKit, use them
    if (mediaControls?.toggleAudio) {
      mediaControls.toggleAudio().then(() => {
        setIsMuted(prev => {
          const newMutedState = !prev;
          // Play sound feedback
          playSound(newMutedState ? 'mute' : 'unmute');
          return newMutedState;
        });
      }).catch(err => {
        console.error('[CallContext] Failed to toggle audio:', err);
      });
    } else {
      // Fallback: just update state (for backward compatibility)
      setIsMuted(prev => {
        const newMutedState = !prev;
        playSound(newMutedState ? 'mute' : 'unmute');
        return newMutedState;
      });
    }
  }, [mediaControls, playSound]);

  const toggleCamera = useCallback(() => {
    // If we have media controls from LiveKit, use them
    if (mediaControls?.toggleVideo) {
      mediaControls.toggleVideo().then(() => {
        setIsCameraOff(prev => !prev);
      }).catch(err => {
        console.error('[CallContext] Failed to toggle video:', err);
      });
    } else {
      // Fallback: just update state (for backward compatibility)
      setIsCameraOff(prev => !prev);
    }
  }, [mediaControls]);

  const toggleSpeaker = useCallback(() => {
    setIsSpeakerOn(prev => !prev);
  }, []);

  const toggleScreenShare = useCallback(() => {
    setIsScreenSharing(prev => !prev);
  }, []);

  const updateStatus = useCallback((newStatus: CallStatus) => {
    setStatus(newStatus);
  }, []);

  const updateConnectedAt = useCallback((timestamp: number) => {
    setConnectedAt(timestamp);
  }, []);

  const value: CallContextValue = {
    callId,
    callType,
    conversationId,
    participantName,
    participantAvatar,
    returnUrl,
    roomName,
    liveKitToken,
    isHost,
    status,
    isMinimized,
    connectedAt,
    isMuted,
    isCameraOff,
    isSpeakerOn,
    isScreenSharing,
    startCall,
    endCall,
    toggleMinimize,
    toggleMute,
    toggleCamera,
    toggleSpeaker,
    toggleScreenShare,
    updateStatus,
    updateConnectedAt,
    setMediaControls,
  };

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCallContext() {
  const context = useContext(CallContext);
  if (context === undefined) {
    throw new Error('useCallContext must be used within a CallProvider');
  }
  return context;
}
