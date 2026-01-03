/**
 * Conversation Store for Slack Agent
 *
 * Maintains conversation history per Slack thread to enable
 * continuous, multi-turn conversations with the AI agent.
 */

import Anthropic from '@anthropic-ai/sdk';

// =============================================================================
// Types
// =============================================================================

export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    userName?: string;
}

export interface Conversation {
    threadTs: string;
    channelId: string;
    messages: ConversationMessage[];
    createdAt: number;
    lastActivityAt: number;
}

// =============================================================================
// In-Memory Store (with TTL cleanup)
// =============================================================================

const conversations = new Map<string, Conversation>();

// Conversation expires after 1 hour of inactivity
const CONVERSATION_TTL_MS = 60 * 60 * 1000;

// Cleanup old conversations every 15 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, conv] of conversations.entries()) {
        if (now - conv.lastActivityAt > CONVERSATION_TTL_MS) {
            conversations.delete(key);
            console.log(`🗑️ Cleaned up expired conversation: ${key}`);
        }
    }
}, 15 * 60 * 1000);

// =============================================================================
// Store Functions
// =============================================================================

/**
 * Generate a unique key for a conversation
 */
function getConversationKey(channelId: string, threadTs: string): string {
    return `${channelId}:${threadTs}`;
}

/**
 * Get or create a conversation
 */
export function getOrCreateConversation(channelId: string, threadTs: string): Conversation {
    const key = getConversationKey(channelId, threadTs);

    let conversation = conversations.get(key);
    if (!conversation) {
        conversation = {
            threadTs,
            channelId,
            messages: [],
            createdAt: Date.now(),
            lastActivityAt: Date.now(),
        };
        conversations.set(key, conversation);
        console.log(`📝 Created new conversation: ${key}`);
    }

    return conversation;
}

/**
 * Add a message to a conversation
 */
export function addMessage(
    channelId: string,
    threadTs: string,
    role: 'user' | 'assistant',
    content: string,
    userName?: string
): void {
    const conversation = getOrCreateConversation(channelId, threadTs);

    conversation.messages.push({
        role,
        content,
        timestamp: Date.now(),
        userName,
    });

    conversation.lastActivityAt = Date.now();

    // Keep only last 20 messages to prevent context overflow
    if (conversation.messages.length > 20) {
        conversation.messages = conversation.messages.slice(-20);
    }
}

/**
 * Get conversation history formatted for Claude API
 */
export function getMessagesForClaude(
    channelId: string,
    threadTs: string
): Anthropic.Messages.MessageParam[] {
    const conversation = getOrCreateConversation(channelId, threadTs);

    return conversation.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
    }));
}

/**
 * Check if a conversation exists
 */
export function hasConversation(channelId: string, threadTs: string): boolean {
    const key = getConversationKey(channelId, threadTs);
    return conversations.has(key);
}

/**
 * Clear a conversation
 */
export function clearConversation(channelId: string, threadTs: string): void {
    const key = getConversationKey(channelId, threadTs);
    conversations.delete(key);
    console.log(`🗑️ Cleared conversation: ${key}`);
}

/**
 * Get conversation stats
 */
export function getStats(): { activeConversations: number; totalMessages: number } {
    let totalMessages = 0;
    for (const conv of conversations.values()) {
        totalMessages += conv.messages.length;
    }
    return {
        activeConversations: conversations.size,
        totalMessages,
    };
}
