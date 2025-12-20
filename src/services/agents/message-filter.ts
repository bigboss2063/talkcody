// src/services/agents/message-filter.ts

import type { ModelMessage, TextPart, ToolCallPart, ToolResultPart } from 'ai';
import { logger } from '@/lib/logger';
import { timedMethod } from '@/lib/timer';

// Type for assistant message content parts
type AssistantContentPart = TextPart | ToolCallPart;

/**
 * MessageFilter handles message optimization and filtering
 * to reduce token usage and improve performance
 */
export class MessageFilter {
  // Exploratory tools that can be filtered after initial discovery phase
  private readonly exploratoryTools = new Set(['glob', 'listFiles', 'codeSearch']);

  // Tools that should be deduplicated (keep only the last occurrence)
  private readonly deduplicateTools = new Set(['todoWrite', 'exitPlanMode']);

  /**
   * Main filtering entry point
   * Applies all filtering optimizations to messages
   */
  @timedMethod('MessageFilter.filterMessages')
  filterMessages(messages: ModelMessage[]): ModelMessage[] {
    const toolCallCount = this.countToolCalls(messages);

    logger.info(`Filtering messages: ${messages.length} messages, ${toolCallCount} tool calls`);

    // Step 1: Collect all toolCallIds that should be filtered
    const toolCallIdsToFilter = this.collectToolCallIdsToFilter(messages);

    if (toolCallIdsToFilter.size === 0) {
      return messages;
    }

    logger.info(`Filtering ${toolCallIdsToFilter.size} tool call pairs`);

    // Step 2: Filter messages by toolCallIds
    const filteredMessages = this.filterByToolCallIds(messages, toolCallIdsToFilter);

    const removedCount = messages.length - filteredMessages.length;
    if (removedCount > 0) {
      logger.info(`Filtered out ${removedCount} messages`);
    }

    return filteredMessages;
  }

  /**
   * Collect all toolCallIds that should be filtered
   */
  private collectToolCallIdsToFilter(messages: ModelMessage[]): Set<string> {
    const toolCallIdsToFilter = new Set<string>();

    // Collect from duplicate file reads
    const duplicateIds = this.getDuplicateFileReadIds(messages);
    for (const id of duplicateIds) {
      toolCallIdsToFilter.add(id);
    }

    // Collect from exploratory tools
    const exploratoryIds = this.getExploratoryToolIds(messages);
    for (const id of exploratoryIds) {
      toolCallIdsToFilter.add(id);
    }

    // Collect from deduplicate tools (todoWrite, exitPlanMode)
    const deduplicateIds = this.getDeduplicateToolIds(messages);
    for (const id of deduplicateIds) {
      toolCallIdsToFilter.add(id);
    }

    return toolCallIdsToFilter;
  }

  /**
   * Get toolCallIds for duplicate file reads (keeping only the most recent)
   */
  private getDuplicateFileReadIds(messages: ModelMessage[]): Set<string> {
    const duplicateIds = new Set<string>();
    // Map to track the latest toolCallId for each unique file read key
    const fileReadMap = new Map<string, string>();

    for (const message of messages) {
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'tool-call' && part.toolName === 'readFile') {
            const fileReadKey = this.extractFileReadKey(part as ToolCallPart);
            if (fileReadKey && part.toolCallId) {
              const previous = fileReadMap.get(fileReadKey);
              if (previous) {
                // Mark the old one for removal
                duplicateIds.add(previous);
                logger.info(`Marking duplicate readFile for removal: ${fileReadKey}`);
              }
              fileReadMap.set(fileReadKey, part.toolCallId);
            }
          }
        }
      }
    }

    return duplicateIds;
  }

  /**
   * Get toolCallIds for exploratory tools outside protection window
   */
  private getExploratoryToolIds(messages: ModelMessage[]): Set<string> {
    const exploratoryIds = new Set<string>();

    // Define a protection window for recent messages
    const protectionWindowSize = 20;
    const protectionThreshold = Math.max(0, messages.length - protectionWindowSize);

    logger.info(`Protection threshold: ${protectionThreshold}, total messages: ${messages.length}`);

    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      if (!message) continue;

      // Skip messages in the protection window
      if (index >= protectionThreshold) {
        continue;
      }

      if (message.role === 'assistant' && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (
            part.type === 'tool-call' &&
            this.isExploratoryTool(part.toolName) &&
            part.toolCallId
          ) {
            exploratoryIds.add(part.toolCallId);
            logger.info(`Marking exploratory tool for removal: ${part.toolName} at index ${index}`);
          }
        }
      }
    }

    return exploratoryIds;
  }

  /**
   * Get toolCallIds for tools that should be deduplicated (keeping only the last occurrence)
   * Unlike file reads, these are deduplicated by tool name only, not by parameters
   */
  private getDeduplicateToolIds(messages: ModelMessage[]): Set<string> {
    const duplicateIds = new Set<string>();
    // Map to track the latest toolCallId for each deduplicate tool
    const toolCallMap = new Map<string, string>();

    for (const message of messages) {
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (
            part.type === 'tool-call' &&
            part.toolCallId &&
            this.deduplicateTools.has(part.toolName)
          ) {
            const previous = toolCallMap.get(part.toolName);
            if (previous) {
              // Mark the old one for removal
              duplicateIds.add(previous);
              logger.info(`Marking duplicate ${part.toolName} for removal`);
            }
            toolCallMap.set(part.toolName, part.toolCallId);
          }
        }
      }
    }

    return duplicateIds;
  }

  /**
   * Filter messages by removing tool-call and tool-result parts with matching toolCallIds
   */
  private filterByToolCallIds(
    messages: ModelMessage[],
    toolCallIdsToFilter: Set<string>
  ): ModelMessage[] {
    const result: ModelMessage[] = [];

    for (const message of messages) {
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        // Filter out tool-call parts that match
        const filteredContent = (message.content as AssistantContentPart[]).filter((part) => {
          if (part.type === 'tool-call' && part.toolCallId) {
            return !toolCallIdsToFilter.has(part.toolCallId);
          }
          return true;
        });

        // Only keep message if it has remaining tool-call content
        // (discard messages that only have text parts after filtering)
        const hasToolCall = filteredContent.some((part) => part.type === 'tool-call');
        if (hasToolCall) {
          result.push({
            ...message,
            content: filteredContent,
          });
        }
      } else if (message.role === 'tool' && Array.isArray(message.content)) {
        // Filter out tool-result parts that match
        const filteredContent = (message.content as ToolResultPart[]).filter((part) => {
          if (part.type === 'tool-result' && part.toolCallId) {
            return !toolCallIdsToFilter.has(part.toolCallId);
          }
          return true;
        });

        // Only keep message if it has remaining content
        if (filteredContent.length > 0) {
          result.push({
            ...message,
            content: filteredContent,
          });
        }
      } else {
        // Keep other messages as-is (system, user)
        result.push(message);
      }
    }

    return result;
  }

  /**
   * Count total tool calls in messages
   */
  private countToolCalls(messages: ModelMessage[]): number {
    let count = 0;
    for (const message of messages) {
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'tool-call') {
            count++;
          }
        }
      }
    }
    return count;
  }

  /**
   * Extract file read key from readFile tool call
   * Returns a unique key that includes file path and line range (if specified)
   */
  private extractFileReadKey(toolCall: ToolCallPart | undefined): string | null {
    if (!toolCall || toolCall.type !== 'tool-call') {
      return null;
    }
    try {
      const input =
        typeof toolCall.input === 'string' ? JSON.parse(toolCall.input) : toolCall.input;

      const filePath = input?.file_path || input?.filePath || input?.path;
      if (!filePath) {
        return null;
      }

      const startLine = input?.start_line ?? 'full';
      const lineCount = input?.line_count ?? 'full';

      return `${filePath}:${startLine}:${lineCount}`;
    } catch (error) {
      logger.warn('Failed to extract file read key from tool call:', error);
      return null;
    }
  }

  /**
   * Check if a tool is exploratory
   */
  private isExploratoryTool(toolName: string): boolean {
    return this.exploratoryTools.has(toolName);
  }

  // Legacy methods for backwards compatibility - delegate to new implementation

  /**
   * @deprecated Use filterMessages instead
   */
  filterDuplicateFileReads(messages: ModelMessage[]): ModelMessage[] {
    const duplicateIds = this.getDuplicateFileReadIds(messages);
    if (duplicateIds.size === 0) {
      return messages;
    }
    return this.filterByToolCallIds(messages, duplicateIds);
  }

  /**
   * @deprecated Use filterMessages instead
   */
  filterExploratoryTools(messages: ModelMessage[]): ModelMessage[] {
    const exploratoryIds = this.getExploratoryToolIds(messages);
    if (exploratoryIds.size === 0) {
      return messages;
    }
    return this.filterByToolCallIds(messages, exploratoryIds);
  }
}
