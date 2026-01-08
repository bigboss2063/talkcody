import { renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { RepositoryStoreProvider, useRepositoryStore } from './window-scoped-repository-store';
import { settingsManager } from './settings-store';

// Mock all external dependencies
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('./settings-store', () => ({
  settingsManager: {
    setCurrentRootPath: vi.fn(),
    getCurrentRootPath: vi.fn().mockReturnValue(''),
    setCurrentProjectId: vi.fn().mockResolvedValue(undefined),
  },
  useSettingsStore: {
    getState: vi.fn().mockReturnValue({ language: 'en' }),
  },
}));

vi.mock('@/services/repository-service', () => ({
  repositoryService: {
    buildDirectoryTree: vi.fn().mockResolvedValue({
      path: '/test/path',
      name: 'test',
      is_directory: true,
      children: [],
    }),
    clearCache: vi.fn(),
    selectRepositoryFolder: vi.fn(),
    readFileWithCache: vi.fn(),
    writeFile: vi.fn(),
    invalidateCache: vi.fn(),
    getFileNameFromPath: vi.fn((path: string) => path.split('/').pop()),
  },
}));

vi.mock('@/services/fast-directory-tree-service', () => ({
  fastDirectoryTreeService: {
    clearCache: vi.fn().mockResolvedValue(undefined),
    loadDirectoryChildren: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/services/database-service', () => ({
  databaseService: {
    createOrGetProjectForRepository: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'Test Project' }),
    getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'Test Project' }),
    trackProjectOpened: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/window-manager-service', () => ({
  WindowManagerService: {
    getCurrentWindowLabel: vi.fn().mockResolvedValue('main'),
    updateWindowProject: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/window-restore-service', () => ({
  WindowRestoreService: {
    saveCurrentWindowState: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('window-scoped-repository-store - selectRepository UI freeze bug', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RepositoryStoreProvider>{children}</RepositoryStoreProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  it('should return immediately without blocking UI when selecting repository', async () => {
    const { repositoryService } = await import('@/services/repository-service');
    const { databaseService } = await import('@/services/database-service');

    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValue('/test/new-project');
    vi.mocked(repositoryService.buildDirectoryTree).mockImplementation(
      () =>
        new Promise((resolve) => {
          // Simulate slow directory tree building (500ms)
          setTimeout(() => {
            resolve({
              path: '/test/new-project',
              name: 'new-project',
              is_directory: true,
              children: [],
            });
          }, 500);
        })
    );

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    const startTime = Date.now();
    const selectRepositoryPromise = result.current.selectRepository();

    // selectRepository should return quickly (before tree building completes)
    const project = await selectRepositoryPromise;
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Should return in less than 200ms (not wait for 500ms tree building)
    expect(duration).toBeLessThan(200);
    expect(project).toEqual({ id: 'proj-1', name: 'Test Project' });
    expect(databaseService.createOrGetProjectForRepository).toHaveBeenCalledWith('/test/new-project');
  });

  it('should run openRepository in background without blocking', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValue('/test/background-project');
    vi.mocked(repositoryService.buildDirectoryTree).mockImplementation(
      () =>
        new Promise((resolve) => {
          // Simulate slow directory tree building (500ms)
          setTimeout(() => {
            resolve({
              path: '/test/background-project',
              name: 'background-project',
              is_directory: true,
              children: [],
            });
          }, 500);
        })
    );

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    // Start selection
    await result.current.selectRepository();

    // openRepository should be called in background
    expect(repositoryService.buildDirectoryTree).toHaveBeenCalled();

    // Repository should eventually open (after background processing)
    await waitFor(() => expect(result.current.rootPath).toBe('/test/background-project'), {
      timeout: 1000,
    });
  });

  it('should handle multiple rapid selectRepository calls correctly', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    // First call - slow response
    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValueOnce('/test/first-project');
    vi.mocked(repositoryService.buildDirectoryTree).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              path: '/test/first-project',
              name: 'first-project',
              is_directory: true,
              children: [],
            });
          }, 500);
        })
    );

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    // Start first selection
    result.current.selectRepository();

    // Immediately try to select another repository
    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValueOnce('/test/second-project');
    result.current.selectRepository();

    // Wait for completion
    await waitFor(() => expect(result.current.rootPath).toBe('/test/second-project'), { timeout: 1000 });

    // Should have selected the second project (not first)
    expect(result.current.rootPath).toBe('/test/second-project');
  });

  it('should not rebuild directory tree for same path', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    // First open
    await result.current.openRepository('/test/same-project', 'proj-1');

    // Wait for openRepository to complete
    await waitFor(() => {
      expect(result.current.rootPath).toBe('/test/same-project');
    });

    vi.clearAllMocks();

    // Try to open the same path again
    await result.current.openRepository('/test/same-project', 'proj-1');

    // buildDirectoryTree should not be called again
    expect(repositoryService.buildDirectoryTree).not.toHaveBeenCalled();
  });
});

describe('window-scoped-repository-store - external file change handling', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RepositoryStoreProvider>{children}</RepositoryStoreProvider>
  );

  const testFilePath = '/test/path/file.ts';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should invalidate cache when external file change is detected', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    // Call handleExternalFileChange
    result.current.handleExternalFileChange(testFilePath);

    // Verify that invalidateCache was called with the file path
    expect(repositoryService.invalidateCache).toHaveBeenCalledWith(testFilePath);
  });

  it('should handle multiple file changes by invalidating each cache', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    const file1Path = '/test/path/file1.ts';
    const file2Path = '/test/path/file2.ts';

    // Handle external change for multiple files
    result.current.handleExternalFileChange(file1Path);
    result.current.handleExternalFileChange(file2Path);

    // Verify each file's cache was invalidated
    expect(repositoryService.invalidateCache).toHaveBeenCalledWith(file1Path);
    expect(repositoryService.invalidateCache).toHaveBeenCalledWith(file2Path);
  });
});
