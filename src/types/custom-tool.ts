import type { ReactElement } from 'react';
import type { z } from 'zod';
import type { ToolExecuteContext, ToolInput, ToolOutput, ToolRenderContext } from './tool';

export type CustomToolPermission = 'fs' | 'net' | 'command';

export interface CustomToolUIContext extends ToolRenderContext {
  toolName: string;
}

export interface CustomToolUI<
  TInput extends ToolInput = ToolInput,
  TOutput extends ToolOutput = ToolOutput,
> {
  Doing?: (params: TInput, context?: CustomToolUIContext) => ReactElement;
  Result?: (result: TOutput, params: TInput, context?: CustomToolUIContext) => ReactElement;
}

export interface CustomToolDefinition<
  TInput extends ToolInput = ToolInput,
  TOutput extends ToolOutput = ToolOutput,
> {
  name: string;
  description: {
    en: string;
    zh: string;
  };
  args: z.ZodSchema<TInput>;
  permissions?: CustomToolPermission[];
  execute: (params: TInput, context: ToolExecuteContext) => Promise<TOutput>;
  ui?: CustomToolUI<TInput, TOutput>;
  hidden?: boolean;
  isBeta?: boolean;
  badgeLabel?: string;
}

export interface CustomToolExport {
  default: CustomToolDefinition;
}
