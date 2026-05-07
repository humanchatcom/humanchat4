/**
 * Call action buttons in chat header
 * Shows "Start video call" and "Start audio call" buttons
 * Enabled during expert's available calendar hours
 */

'use client';

import { useState, useMemo, useEffect } from 'react';
import { Video, Phone } from 'lucide-react';
import { startCall } from '../services/callApi';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { sessionStatusManager } from '../services/sessionStatusManager';
import { useCallSounds } from '../hooks/useCallSounds';
import styles from './ConversationView.module.css';

interface ChatHeaderCallActionsProps {
  conversationId: string;
  isConversationAccepted: boolean;
  compact?: boolean;
  participantIds?: string[];
}

export default function ChatHeaderCallActions({
  conversationId,
  isConversationAccepted,
  compact = false,
  participantIds = [],
}: ChatHeaderCallActionsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isStarting, setIsStarting] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const { play: playSound, stop: stopSound } = useCallSounds();

  useEffect(() => {
    setCurrentUserId(sessionStatusManager.getCurrentUserId());
    return sessionStatusManager.onCurrentUserChange((userId) => setCurrentUserId(userId));
  }, []);

  // Get the expert ID (the other participant who is not the current user)
  const expertId = useMemo(() => {
    if (!currentUserId || participantIds.length === 0) return null;
    return participantIds.find(id => id !== currentUserId) || null;
  }, [currentUserId, participantIds]);

  console.log('[ChatHeaderCallActions] Rendered:', { 
    conversationId, 
    isConversationAccepted,
    expertId,
  });

  const handleStartCall = async (callType: 'video' | 'audio') => {
    console.log('[ChatHeaderCallActions] Starting call:', { conversationId, callType });

    if (!isConversationAccepted) {
      console.warn('[ChatHeaderCallActions] Conversation not accepted');
      alert('Wait for the chat request to be accepted first');
      return;
    }

    setIsStarting(true);

    try {
      console.log('[ChatHeaderCallActions] Calling startCall API...');
      const result = await startCall({
        conversationId,
        callType,
      });
      
      console.log('[ChatHeaderCallActions] Call started successfully:', result);

      // Build return URL with current path and params
      const currentUrl = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;

      // Navigate to live room with returnUrl
      // Note: Outgoing ring will be played by the call page to avoid audio stopping during navigation
      router.push(`/call/${result.callId}?returnUrl=${encodeURIComponent(currentUrl)}`);
    } catch (error: any) {
      console.error('[ChatHeaderCallActions] Failed to start call:', error);
      console.error('[ChatHeaderCallActions] Error details:', {
        status: error?.status,
        message: error?.message,
        fullError: JSON.stringify(error, null, 2)
      });
      
      if (error.status === 409) {
        alert('A call is already in progress');
      } else {
        alert(error.message || 'Failed to start call. Please try again.');
      }
    } finally {
      setIsStarting(false);
    }
  };

  const callsDisabled = !isConversationAccepted;
  const tooltipMessage = useMemo(() => {
    if (!isConversationAccepted) return 'Waiting for chat acceptance';
    return '';
  }, [isConversationAccepted]);

  return (
    <div className={compact ? styles.callButtonsCompact : styles.callButtons}>
      <button
        onClick={() => handleStartCall('video')}
        disabled={isStarting}
        className={compact ? styles.callButtonCompact : styles.callButtonPrimary}
        aria-label="Start video call"
        title={callsDisabled ? tooltipMessage : 'Start video call'}
        style={{ 
          opacity: callsDisabled ? 0.5 : 1,
          cursor: callsDisabled ? 'not-allowed' : 'pointer'
        }}
      >
        <Video size={compact ? 16 : 18} />
        {!compact && <span>Video call</span>}
      </button>

      <button
        onClick={() => handleStartCall('audio')}
        disabled={isStarting}
        className={compact ? styles.callButtonCompact : styles.callButtonSecondary}
        aria-label="Start audio call"
        title={callsDisabled ? tooltipMessage : 'Start audio call'}
        style={{ 
          opacity: callsDisabled ? 0.5 : 1,
          cursor: callsDisabled ? 'not-allowed' : 'pointer'
        }}
      >
        <Phone size={compact ? 16 : 18} />
        {!compact && <span>Audio call</span>}
      </button>
    </div>
  );
}
