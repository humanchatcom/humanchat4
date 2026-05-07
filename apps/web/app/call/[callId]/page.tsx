/**
 * Call page - /call/[callId]
 * Initializes call context and redirects to returnUrl
 * GlobalCallRoom in layout handles the actual call UI rendering
 */

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getCall } from '@/services/callApi';
import { useCallContext } from '@/context/CallContext';

export default function CallPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const callId = params.callId as string;
  const returnUrl = searchParams.get('returnUrl');
  const { startCall, endCall: endCallContext } = useCallContext();

  const [callData, setCallData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load call data and initialize context, then redirect to returnUrl
  // GlobalCallRoom will handle the actual rendering
  useEffect(() => {
    async function loadCall() {
      try {
        const data = await getCall(callId);
        
        if (data.status === 'ended' || data.status === 'declined' || data.status === 'missed') {
          setError('This call has already ended');
          setTimeout(() => router.push('/chat'), 2000);
          return;
        }

        setCallData(data);
        
        // Initialize call context with returnUrl
        const targetReturnUrl = returnUrl || `/chat?conversationId=${data.conversationId}`;
        startCall({
          callId,
          callType: data.callType,
          conversationId: data.conversationId,
          participantName: data.participantName || 'Unknown',
          participantAvatar: data.participantAvatar,
          returnUrl: targetReturnUrl,
          roomName: data.roomName,
          liveKitToken: data.liveKitToken,
          isHost: data.isHost ?? false,
        });
        
        // Redirect to returnUrl immediately - GlobalCallRoom will show the call UI
        router.replace(targetReturnUrl);
      } catch (err: any) {
        console.error('Failed to load call:', err);
        setError(err.message || 'Failed to load call');
        setTimeout(() => router.push('/chat'), 2000);
      } finally {
        setLoading(false);
      }
    }

    loadCall();
  }, [callId, router, startCall, returnUrl]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-[#1a1f3a] via-[#0f1419] to-[#000000] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-xl">Connecting...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-[#1a1f3a] via-[#0f1419] to-[#000000] flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-xl mb-4">{error}</div>
          <p className="text-gray-400">Redirecting...</p>
        </div>
      </div>
    );
  }

  // Redirecting to returnUrl, GlobalCallRoom will take over
  return null;
}
