'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import CallShell from '@/components/CallShell';
import AudioCallPage from '@/components/AudioCallPage';
import VideoCallPage from '@/components/VideoCallPage';
import { useCallContext } from '@/context/CallContext';
import { getCall, endCall as endCallApi } from '@/services/callApi';

export default function CallPageV2() {
  const params = useParams();
  const router = useRouter();
  const callId = params.callId as string;
  
  const { startCall, endCall, callType, conversationId } = useCallContext();
  
  const [callData, setCallData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCall() {
      try {
        console.log('[CallPageV2] Loading call:', callId);
        const data = await getCall(callId);
        
        console.log('[CallPageV2] Call data:', data);
        
        if (data.status === 'ended' || data.status === 'declined' || data.status === 'missed') {
          setError('This call has already ended');
          setTimeout(() => {
            const chatUrl = data.conversationId ? `/chat?conversationId=${data.conversationId}` : '/chat';
            router.push(chatUrl);
          }, 2000);
          return;
        }

        setCallData(data);
        
        startCall({
          callId: data.callId,
          callType: data.callType,
          conversationId: data.conversationId,
          participantName: data.participantName || 'User',
          participantAvatar: data.participantAvatar,
          returnUrl: `/chat${data.conversationId ? `?conversationId=${data.conversationId}` : ''}`,
          roomName: data.roomName,
          liveKitToken: data.liveKitToken,
          isHost: data.isHost ?? false,
        });
        
      } catch (err: any) {
        console.error('[CallPageV2] Failed to load call:', err);
        setError(err.message || 'Failed to load call');
        setTimeout(() => router.push('/chat'), 2000);
      } finally {
        setLoading(false);
      }
    }

    loadCall();
  }, [callId, router, startCall]);

  const handleEndCall = async () => {
    try {
      console.log('[CallPageV2] Ending call:', callId);
      await endCallApi(callId, 'normal');
      endCall();
      
      // Wait for call summary message
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Navigate to conversation
      const chatUrl = conversationId ? `/chat?conversationId=${conversationId}` : '/chat';
      router.push(chatUrl);
    } catch (error) {
      console.error('[CallPageV2] Failed to end call:', error);
      endCall();
      const chatUrl = conversationId ? `/chat?conversationId=${conversationId}` : '/chat';
      router.push(chatUrl);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-[#0f1729] via-[#1a1f3a] to-[#0a0e1a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-xl">Connecting...</p>
        </div>
      </div>
    );
  }

  if (error || !callData) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-[#0f1729] via-[#1a1f3a] to-[#0a0e1a] flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-xl mb-4">{error || 'Call not found'}</div>
          <p className="text-gray-400">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <CallShell
      roomName={callData.roomName}
      liveKitToken={callData.liveKitToken}
    >
      {callType === 'audio' ? (
        <AudioCallPage onEndCall={handleEndCall} />
      ) : (
        <VideoCallPage onEndCall={handleEndCall} />
      )}
    </CallShell>
  );
}
