// Changelog data service for What's New dialog

export interface ChangelogContent {
  added?: string[];
  changed?: string[];
  fixed?: string[];
  removed?: string[];
  security?: string[];
  deprecated?: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  en: ChangelogContent;
  zh: ChangelogContent;
}

// Changelog data - update this when releasing new versions
// Only include the most recent versions that users care about
export const CHANGELOG_DATA: ChangelogEntry[] = [
  {
    version: '0.1.19',
    date: '2025-12-18',
    en: {
      added: [
        'Multi-Agent parallel execution (experimental), supporting multiple agents executing tasks simultaneously',
        'Git Worktree-based parallel task execution (experimental), supporting multiple tasks running in isolated working directories',
        'One-click Git Commit: Added Commit button in file changes summary, AI automatically generates commit message',
        'One-click Code Review: Added Review button in file changes summary to invoke Code Review Agent',
      ],
      changed: [
        'Improved MCP tool selection button',
        'Optimized local Agent loading performance',
        'Improved Edit File tool',
        'Improved dangerous command detection in Bash tool',
        'Optimized Context Compaction logic',
        'Optimized AI request retry strategy',
      ],
      fixed: [
        'Fixed Windows terminal bug',
        'Fixed global content search exiting immediately when pressing space',
      ],
    },
    zh: {
      added: [
        '多 Agent 并行执行（实验版本），支持多个 Agent 同时执行任务',
        '基于 Git Worktree 的 Task 并行执行（实验版本），支持多个 Task 在独立工作目录中并行运行',
        '一键 Git Commit：在文件变更摘要中新增 Commit 按钮，AI 自动生成提交信息',
        '一键 Code Review：在文件变更摘要中新增 Review 按钮，一键调用 Code Review Agent',
      ],
      changed: [
        '优化 MCP 工具选择按钮',
        '优化本地 Agent 加载性能',
        '改进 Edit File 工具',
        '改进 Bash 工具的危险命令检测',
        '优化 Context Compaction 逻辑',
        '优化 AI 请求的重试策略',
      ],
      fixed: ['修复 Windows 终端的 bug', '修复全局内容搜索空格直接退出的 bug'],
    },
  },
];

export function getChangelogForVersion(version: string): ChangelogEntry | undefined {
  return CHANGELOG_DATA.find((entry) => entry.version === version);
}

export function getLatestChangelog(): ChangelogEntry | undefined {
  return CHANGELOG_DATA[0];
}
