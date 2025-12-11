import type { ReactElement } from 'react';
import type { z } from 'zod';

// Tool input/output types
export type ToolInput = Record<string, unknown>;
export type ToolOutput = unknown;

export interface ToolWithUI<
  TInput extends ToolInput = ToolInput,
  TOutput extends ToolOutput = ToolOutput,
> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  execute: (params: TInput) => Promise<TOutput>;
  renderToolDoing: (params: TInput) => ReactElement;
  renderToolResult: (result: TOutput, params: TInput) => ReactElement;
  canConcurrent: boolean;
  /** Whether to hide this tool from the UI tool selector */
  hidden?: boolean;
  /** Whether this tool is in beta/preview */
  isBeta?: boolean;
  /** Optional custom label for the beta badge */
  badgeLabel?: string;
}
