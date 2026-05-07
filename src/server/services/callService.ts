/**
 * Call session business logic service
 */

import { query } from '../db/postgres.js';
import { ApiError } from '../errors/ApiError.js';
import { generateLiveKitToken, generateRoomName } from './liveKitService.js';
import { publishToRedis } from '../utils/redis.js';
import { addConversationMessage } from './conversationService.js';
import {
  CallSession,
  CallType,
  CallStatus,
  StartCallRequest,
  StartCallResponse,
  AcceptCallResponse,
  WSCallRingingMessage,
  WSCallAcceptedMessage,
  WSCallDeclinedMessage,
  WSCallEndedMessage,
  WSCallTimeoutMessage,
} from '../types/calls.js';

const CALL_TIMEOUT_MS = 60000; // 60 seconds

/**
 * Start a new call session
 */
export async function startCall(
  request: StartCallRequest,
  callerUserId: string
): Promise<StartCallResponse> {
  const { conversationId, callType, idempotencyKey } = request;

  // Check for existing active call with idempotency
  if (idempotencyKey) {
    const existing = await query<CallSession>(
      `SELECT * FROM call_sessions 
       WHERE conversation_id = $1 
       AND caller_user_id = $2 
       AND status IN ('initiated', 'accepted', 'connected')
       ORDER BY initiated_at DESC LIMIT 1`,
      [conversationId, callerUserId]
    );

    if (existing.rows.length > 0) {
      const call = existing.rows[0];
      // Return existing call (idempotent)
      const token = await generateLiveKitToken({
        roomName: call.livekit_room_name!,
        userId: callerUserId,
        userName: 'Caller',
        callId: call.id,
      });

      // Fetch participants
      const participants = await getCallParticipants(conversationId, callerUserId);

      return {
        callId: call.id,
        status: call.status,
        liveKitToken: token,
        roomName: call.livekit_room_name!,
        participants,
        initiatedAt: typeof call.initiated_at === 'string' ? call.initiated_at : call.initiated_at.toISOString(),
      };
    }
  }

  // Validate conversation exists and user is participant
  const conversation = await query(
    `SELECT c.id, c.participants, c.type
     FROM conversations c
     WHERE c.id = $1 AND $2 = ANY(c.participants)`,
    [conversationId, callerUserId]
  );

  if (conversation.rows.length === 0) {
    throw new ApiError(404, 'NOT_FOUND', 'Conversation not found or access denied');
  }

  const conv = conversation.rows[0];

  if (conv.type !== 'human') {
    throw new ApiError(400, 'INVALID_REQUEST', 'Can only call human conversations');
  }

  // Get participant details
  const participants = conv.participants as string[];
  if (participants.length !== 2) {
    throw new ApiError(400, 'INVALID_REQUEST', 'Call requires exactly 2 participants');
  }

  const calleeUserId = participants.find((p: string) => p !== callerUserId);
  if (!calleeUserId) {
    throw new ApiError(400, 'INVALID_REQUEST', 'Could not determine callee');
  }

  // Get user details
  const users = await query(
    `SELECT id, name, avatar_url FROM users WHERE id = ANY($1)`,
    [participants]
  );

  const callerUser = users.rows.find((u: any) => u.id === callerUserId);
  const calleeUser = users.rows.find((u: any) => u.id === calleeUserId);

  if (!callerUser || !calleeUser) {
    throw new ApiError(404, 'NOT_FOUND', 'User not found');
  }

  // Check for duplicate active call
  const activeCall = await query(
    `SELECT id, initiated_at, status FROM call_sessions 
     WHERE conversation_id = $1 
     AND status IN ('initiated', 'accepted', 'connected')`,
    [conversationId]
  );

  if (activeCall.rows.length > 0) {
    const existingCall = activeCall.rows[0];
    const callAge = Date.now() - new Date(existingCall.initiated_at).getTime();
    // Auto-cleanup stale calls:
    // - Initiated calls older than 1 minute (likely failed to connect)
    // - Accepted calls older than 2 minutes (likely failed to connect)
    // - Connected calls are kept active (no auto-cleanup)
    const isStale = 
      (existingCall.status === 'initiated' && callAge > 60 * 1000) || // 1 minute
      (existingCall.status === 'accepted' && callAge > 2 * 60 * 1000); // 2 minutes
    
    if (isStale) {
      console.log(`[CallService] Cleaning up stale ${existingCall.status} call: ${existingCall.id} (age: ${Math.floor(callAge / 1000)}s)`);
      await query(
        `UPDATE call_sessions 
         SET status = 'failed', ended_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [existingCall.id]
      );
    } else {
      throw new ApiError(409, 'CALL_IN_PROGRESS', 'An active call already exists for this conversation');
    }
  }

  const callerName = callerUser.name;
  const calleeName = calleeUser.name;
  const callerAvatar = callerUser.avatar_url;
  const calleeAvatar = calleeUser.avatar_url;

  // Create call session
  const callId = crypto.randomUUID();
  const roomName = generateRoomName(callId);

  const result = await query<CallSession>(
    `INSERT INTO call_sessions (
      id, conversation_id, caller_user_id, callee_user_id,
      call_type, status, livekit_room_name
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`,
    [callId, conversationId, callerUserId, calleeUserId, callType, 'initiated', roomName]
  );

  const callSession = result.rows[0];

  // Log event
  await logCallEvent(callId, callerUserId, 'initiated', {
    callType,
    conversationId,
  });

  // Generate LiveKit token for caller
  const callerToken = await generateLiveKitToken({
    roomName,
    userId: callerUserId,
    userName: callerName,
    callId,
    metadata: JSON.stringify({ role: 'caller', callId }),
  });

  // Publish ringing notification to callee via Redis
  const ringingMessage: WSCallRingingMessage = {
    type: 'CALL_RINGING',
    callId,
    conversationId,
    caller: {
      userId: callerUserId,
      name: callerName,
      avatar: callerAvatar,
    },
    callType,
    initiatedAt: new Date(callSession.initiated_at).toISOString(),
  };

  await publishToRedis('notification', JSON.stringify({ ...ringingMessage, userId: calleeUserId }));

  // Schedule timeout check
  scheduleCallTimeout(callId, calleeUserId);

  return {
    callId,
    status: 'initiated',
    liveKitToken: callerToken,
    roomName,
    participants: {
      caller: {
        userId: callerUserId,
        name: callerName,
        avatar: callerAvatar,
      },
      callee: {
        userId: calleeUserId,
        name: calleeName,
        avatar: calleeAvatar,
      },
    },
    initiatedAt: new Date(callSession.initiated_at).toISOString(),
  };
}

/**
 * Accept an incoming call
 */
export async function acceptCall(
  callId: string,
  calleeUserId: string
): Promise<AcceptCallResponse> {
  // Get call session
  const result = await query<CallSession>(
    `SELECT cs.*, 
            caller.name as caller_name, callee.name as callee_name
     FROM call_sessions cs
     JOIN users caller ON cs.caller_user_id = caller.id
     JOIN users callee ON cs.callee_user_id = callee.id
     WHERE cs.id = $1 AND cs.callee_user_id = $2`,
    [callId, calleeUserId]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'NOT_FOUND', 'Call not found or access denied');
  }

  const call = result.rows[0];

  if (call.status !== 'initiated') {
    throw new ApiError(400, 'INVALID_REQUEST', `Call cannot be accepted in ${call.status} state`);
  }

  // Update call status
  await query(
    `UPDATE call_sessions 
     SET status = $1, accepted_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    ['accepted', callId]
  );

  // Log event
  await logCallEvent(callId, calleeUserId, 'accepted');

  // Generate LiveKit token for callee
  const calleeToken = await generateLiveKitToken({
    roomName: call.livekit_room_name!,
    userId: calleeUserId,
    userName: call.callee_name || 'User',
    callId,
    metadata: JSON.stringify({ role: 'callee', callId }),
  });

  // Notify caller via Redis
  const acceptedMessage: WSCallAcceptedMessage = {
    type: 'CALL_ACCEPTED',
    callId,
    acceptedBy: {
      userId: calleeUserId,
      name: call.callee_name || 'User',
    },
    acceptedAt: new Date().toISOString(),
  };

  await publishToRedis('notification', JSON.stringify({ ...acceptedMessage, userId: call.caller_user_id }));

  return {
    callId,
    status: 'accepted',
    liveKitToken: calleeToken,
    roomName: call.livekit_room_name!,
    acceptedAt: new Date().toISOString(),
  };
}

/**
 * Decline an incoming call
 */
export async function declineCall(
  callId: string,
  calleeUserId: string,
  reason?: string
): Promise<void> {
  const result = await query<CallSession>(
    `SELECT cs.*, callee.name as callee_name
     FROM call_sessions cs
     JOIN users callee ON cs.callee_user_id = callee.id
     WHERE cs.id = $1 AND cs.callee_user_id = $2`,
    [callId, calleeUserId]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'NOT_FOUND', 'Call not found or access denied');
  }

  const call = result.rows[0];

  if (call.status !== 'initiated') {
    throw new ApiError(400, 'INVALID_REQUEST', `Call cannot be declined in ${call.status} state`);
  }

  // Update call status
  await query(
    `UPDATE call_sessions 
     SET status = $1, ended_at = NOW(), end_reason = $2, updated_at = NOW()
     WHERE id = $3`,
    ['declined', reason || 'declined', callId]
  );

  // Log event
  await logCallEvent(callId, calleeUserId, 'declined', { reason });

  // Notify caller
  const declinedMessage: WSCallDeclinedMessage = {
    type: 'CALL_DECLINED',
    callId,
    declinedBy: {
      userId: calleeUserId,
      name: call.callee_name || 'User',
    },
    reason,
    declinedAt: new Date().toISOString(),
  };

  await publishToRedis('notification', JSON.stringify({ ...declinedMessage, userId: call.caller_user_id }));
}

/**
 * End an active call
 */
export async function endCall(
  callId: string,
  userId: string,
  endReason: string = 'normal'
): Promise<void> {
  const result = await query<CallSession>(
    `SELECT cs.*, 
            EXTRACT(EPOCH FROM (NOW() - cs.connected_at))::INTEGER as duration_calc,
            ender.name as ender_name,
            caller.name as caller_name,
            callee.name as callee_name
     FROM call_sessions cs
     JOIN users ender ON (cs.caller_user_id = $2 OR cs.callee_user_id = $2)
     JOIN users caller ON cs.caller_user_id = caller.id
     JOIN users callee ON cs.callee_user_id = callee.id
     WHERE cs.id = $1 AND (cs.caller_user_id = $2 OR cs.callee_user_id = $2)`,
    [callId, userId]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'NOT_FOUND', 'Call not found or access denied');
  }

  const call = result.rows[0];

  console.log('[CallService] Ending call:', {
    callId,
    conversationId: call.conversation_id,
    status: call.status,
    connectedAt: call.connected_at,
  });

  if (call.status === 'ended' || call.status === 'declined' || call.status === 'missed') {
    // Already ended, idempotent
    return;
  }

  // Calculate duration: if connected, get seconds elapsed
  const durationSeconds = call.connected_at 
    ? Math.floor((new Date().getTime() - new Date(call.connected_at).getTime()) / 1000)
    : 0;

  // Update call status
  await query(
    `UPDATE call_sessions 
     SET status = $1, ended_at = NOW(), end_reason = $2, 
         duration_seconds = $3, updated_at = NOW()
     WHERE id = $4`,
    ['ended', endReason, durationSeconds, callId]
  );

  // Log event
  await logCallEvent(callId, userId, 'ended', { endReason, durationSeconds });

  // Add system messages to conversation with call details for both parties
  if (call.conversation_id) {
    const formatDuration = (seconds: number): string => {
      if (seconds < 60) return `${seconds}s`;
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    };

    const callType = call.call_type === 'video' ? 'Video' : 'Audio';
    
    // Create message showing call details with duration
    let callSummary: string;
    if (durationSeconds > 0) {
      // Show duration for connected calls
      callSummary = `📞 ${callType} call ended • Duration: ${formatDuration(durationSeconds)}`;
    } else if (endReason === 'missed') {
      // Missed call
      callSummary = `📞 Missed ${callType.toLowerCase()} call`;
    } else {
      // Very short or declined call
      callSummary = `📞 ${callType} call ended`;
    }

    try {
      console.log('[CallService] Adding call summary message to conversation:', {
        conversationId: call.conversation_id,
        durationSeconds,
        summary: callSummary,
      });
      await addConversationMessage(
        call.conversation_id,
        null, // system message (no sender)
        callSummary,
        'system_notice'
      );
      console.log('[CallService] Successfully added call summary to conversation');
    } catch (err) {
      console.error('[CallService] Failed to add call summary to conversation:', err);
    }
  }

  // Notify other participant
  const otherUserId = call.caller_user_id === userId ? call.callee_user_id : call.caller_user_id;

  const endedMessage: WSCallEndedMessage = {
    type: 'CALL_ENDED',
    callId,
    endedBy: {
      userId,
      name: call.ender_name || 'User',
    },
    duration: durationSeconds,
    endReason,
    endedAt: new Date().toISOString(),
  };

  await publishToRedis('notification', JSON.stringify({ ...endedMessage, userId: otherUserId }));
}

/**
 * Get call session by ID
 */
export async function getCallById(callId: string, userId: string): Promise<CallSession | null> {
  const result = await query<CallSession>(
    `SELECT * FROM call_sessions 
     WHERE id = $1 AND (caller_user_id = $2 OR callee_user_id = $2)`,
    [callId, userId]
  );

  return result.rows[0] || null;
}

/**
 * Mark call as connected (when both peers join LiveKit room)
 */
export async function markCallConnected(callId: string): Promise<void> {
  await query(
    `UPDATE call_sessions 
     SET status = $1, connected_at = NOW(), updated_at = NOW()
     WHERE id = $2 AND status = 'accepted'`,
    ['connected', callId]
  );

  await logCallEvent(callId, '', 'connected');
}

/**
 * Log call event
 */
async function logCallEvent(
  callSessionId: string,
  userId: string,
  eventType: string,
  eventData?: Record<string, unknown>
): Promise<void> {
  await query(
    `INSERT INTO call_events (call_session_id, user_id, event_type, event_data)
     VALUES ($1, $2, $3, $4)`,
    [callSessionId, userId || null, eventType, eventData ? JSON.stringify(eventData) : null]
  );
}

/**
 * Schedule timeout check for unanswered call
 */
function scheduleCallTimeout(callId: string, calleeUserId: string): void {
  setTimeout(async () => {
    try {
      const result = await query<CallSession>(
        `SELECT * FROM call_sessions WHERE id = $1`,
        [callId]
      );

      if (result.rows.length === 0) return;

      const call = result.rows[0];

      // Only timeout if still in initiated state
      if (call.status === 'initiated') {
        await query(
          `UPDATE call_sessions 
           SET status = $1, ended_at = NOW(), end_reason = $2, updated_at = NOW()
           WHERE id = $3`,
          ['missed', 'timeout', callId]
        );

        await logCallEvent(callId, '', 'timeout');

        // Notify caller
        const timeoutMessage: WSCallTimeoutMessage = {
          type: 'CALL_TIMEOUT',
          callId,
          timeoutAt: new Date().toISOString(),
        };

        await publishToRedis('notification', JSON.stringify({ ...timeoutMessage, userId: call.caller_user_id }));
      }
    } catch (error) {
      console.error('Error handling call timeout:', error);
    }
  }, CALL_TIMEOUT_MS);
}

/**
 * Helper to get call participants
 */
async function getCallParticipants(conversationId: string, callerUserId: string) {
  const conv = await query(
    `SELECT c.participants
     FROM conversations c
     WHERE c.id = $1`,
    [conversationId]
  );

  if (conv.rows.length === 0) {
    throw new ApiError(404, 'NOT_FOUND', 'Conversation not found');
  }

  const participants = conv.rows[0].participants as string[];
  const calleeUserId = participants.find((p: string) => p !== callerUserId);

  if (!calleeUserId) {
    throw new ApiError(400, 'INVALID_REQUEST', 'Could not determine callee');
  }

  // Get user details
  const users = await query(
    `SELECT id, name, avatar_url FROM users WHERE id = ANY($1)`,
    [participants]
  );

  const callerUser = users.rows.find((u: any) => u.id === callerUserId);
  const calleeUser = users.rows.find((u: any) => u.id === calleeUserId);

  return {
    caller: {
      userId: callerUserId,
      name: callerUser?.name || 'Unknown',
      avatar: callerUser?.avatar_url,
    },
    callee: {
      userId: calleeUserId,
      name: calleeUser?.name || 'Unknown',
      avatar: calleeUser?.avatar_url,
    },
  };
}
