import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTasks } from './use-tasks';

// Mock stores
const mockTasks = new Map();
const mockTaskStoreState = {
  tasks: mockTasks,
  currentTaskId: null as string | null,
  loadingTasks: false,
  setCurrentTaskId: vi.fn(),
  getTask: vi.fn(),
};

vi.mock('@/stores/task-store', () => ({
  useTaskStore: vi.fn((selector) => selector(mockTaskStoreState)),
}));

const mockUIStateStoreState = {
  editingTaskId: null as string | null,
  editingTitle: '',
  setEditingTitle: vi.fn(),
  startEditing: vi.fn(),
  cancelEditing: vi.fn(),
  finishEditing: vi.fn(),
};

vi.mock('@/stores/ui-state-store', () => ({
  useUIStateStore: vi.fn((selector) => selector(mockUIStateStoreState)),
}));

vi.mock('@/stores/settings-store', () => ({
  settingsManager: {
    getProject: vi.fn(),
    setCurrentTaskId: vi.fn(),
    getCurrentTaskId: vi.fn(),
  },
}));

vi.mock('@/services/task-service', () => ({
  taskService: {
    loadTasksWithPagination: vi.fn(),
    loadTasksWithSearchPagination: vi.fn(),
    loadMessages: vi.fn(),
    createTask: vi.fn(),
    selectTask: vi.fn(),
    deleteTask: vi.fn(),
    renameTask: vi.fn(),
    startNewChat: vi.fn(),
  },
}));

vi.mock('@/services/database-service', () => ({
  databaseService: {
    saveMessage: vi.fn(),
    getTaskDetails: vi.fn(),
  },
}));


describe('useTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTasks.clear();
    mockTaskStoreState.currentTaskId = null;
    mockTaskStoreState.loadingTasks = false;
    mockUIStateStoreState.editingTaskId = null;
    mockUIStateStoreState.editingTitle = '';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with correct default values', () => {
    const { result } = renderHook(() => useTasks());

    expect(result.current.tasks).toEqual([]);
    expect(result.current.currentTaskId).toBeUndefined();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.editingId).toBeNull();
    expect(result.current.editingTitle).toBe('');
  });

  it('should return tasks sorted by updated_at descending', () => {
    const task1 = {
      id: 'task1',
      title: 'Task 1',
      created_at: 1000,
      updated_at: 1000,
      project_id: 'proj1',
      message_count: 0,
      cost: 0,
      input_token: 0,
      output_token: 0,
    };
    const task2 = {
      id: 'task2',
      title: 'Task 2',
      created_at: 2000,
      updated_at: 2000,
      project_id: 'proj1',
      message_count: 0,
      cost: 0,
      input_token: 0,
      output_token: 0,
    };
    mockTasks.set('task1', task1);
    mockTasks.set('task2', task2);

    const { result } = renderHook(() => useTasks());

    // Should be sorted by updated_at descending (task2 first)
    expect(result.current.tasks[0].id).toBe('task2');
    expect(result.current.tasks[1].id).toBe('task1');
  });

  it('should load tasks', async () => {
    const { taskService } = await import('@/services/task-service');

    const { result } = renderHook(() => useTasks());
    await act(async () => {
      await result.current.loadTasks('project1');
    });

    expect(taskService.loadTasksWithPagination).toHaveBeenCalledWith('project1', 20, 0, true, true);
  });

  it('should load tasks with search term', async () => {
    const { taskService } = await import('@/services/task-service');

    const { result } = renderHook(() => useTasks());
    await act(async () => {
      await result.current.loadTasks('project1', 'demo');
    });

    expect(taskService.loadTasksWithSearchPagination).toHaveBeenCalledWith(
      'demo',
      'project1',
      20,
      0,
      true,
      true
    );
  });

  it('should handle load tasks error', async () => {
    const { taskService } = await import('@/services/task-service');
    const { logger } = await import('@/lib/logger');
    const loggerErrorSpy = vi.spyOn(logger, 'error');
    (taskService.loadTasksWithPagination as any).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useTasks());
    await act(async () => {
      await result.current.loadTasks();
    });

    expect(result.current.error).toBe('Failed to load tasks');
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to load tasks:', expect.any(Error));

    loggerErrorSpy.mockRestore();
  });

  it('should create a task', async () => {
    const { taskService } = await import('@/services/task-service');
    (taskService.createTask as any).mockResolvedValueOnce('new-task-id');

    const onTaskStart = vi.fn();
    const { result } = renderHook(() => useTasks(onTaskStart));

    let taskId: string;
    await act(async () => {
      taskId = await result.current.createTask('Hello world');
    });

    expect(taskService.createTask).toHaveBeenCalledWith('Hello world', {
      onTaskStart,
    });
    expect(taskId!).toBe('new-task-id');
  });

  it('should select a task', async () => {
    const { taskService } = await import('@/services/task-service');

    const { result } = renderHook(() => useTasks());
    await act(async () => {
      await result.current.selectTask('task1');
    });

    expect(taskService.selectTask).toHaveBeenCalledWith('task1');
  });

  it('should load more tasks without toggling global loading', async () => {
    const { taskService } = await import('@/services/task-service');

    const { result } = renderHook(() => useTasks());
    await act(async () => {
      await result.current.loadMoreTasks('project1');
    });

    expect(taskService.loadTasksWithPagination).toHaveBeenCalledWith('project1', 20, 0, false, false);
  });

  it('should load more tasks with search term', async () => {
    const { taskService } = await import('@/services/task-service');

    const { result } = renderHook(() => useTasks());
    await act(async () => {
      await result.current.loadMoreTasks('project1', 'demo');
    });

    expect(taskService.loadTasksWithSearchPagination).toHaveBeenCalledWith(
      'demo',
      'project1',
      20,
      0,
      false,
      false
    );
  });

  it('should delete a task', async () => {
    const { taskService } = await import('@/services/task-service');

    const { result } = renderHook(() => useTasks());
    await act(async () => {
      await result.current.deleteTask('task1');
    });

    expect(taskService.deleteTask).toHaveBeenCalledWith('task1');
  });

  it('should save a message', async () => {
    const { databaseService } = await import('@/services/database-service');

    const { result } = renderHook(() => useTasks());
    await act(async () => {
      await result.current.saveMessage('task1', 'user', 'Hello', 0, 'agent-1', []);
    });

    expect(databaseService.saveMessage).toHaveBeenCalledWith(
      'task1',
      'user',
      'Hello',
      0,
      'agent-1',
      []
    );
  });

  it('should get task details', async () => {
    const { databaseService } = await import('@/services/database-service');
    const mockDetails = { id: 'task1', title: 'Test' };
    (databaseService.getTaskDetails as any).mockResolvedValueOnce(mockDetails);

    const { result } = renderHook(() => useTasks());
    const details = await result.current.getTaskDetails('task1');

    expect(databaseService.getTaskDetails).toHaveBeenCalledWith('task1');
    expect(details).toEqual(mockDetails);
  });

  it('should start a new chat', async () => {
    const { taskService } = await import('@/services/task-service');

    const { result } = renderHook(() => useTasks());
    act(() => {
      result.current.startNewChat();
    });

    expect(taskService.startNewChat).toHaveBeenCalled();
  });

  it('should set current task ID', async () => {
    const { settingsManager } = await import('@/stores/settings-store');
    const { useTaskStore } = await import('@/stores/task-store');
    const mockSetCurrentTaskId = vi.fn();
    (useTaskStore as any).getState = vi.fn().mockReturnValue({
      setCurrentTaskId: mockSetCurrentTaskId,
    });

    const { result } = renderHook(() => useTasks());
    act(() => {
      result.current.setCurrentTaskId('task1');
    });

    expect(mockSetCurrentTaskId).toHaveBeenCalledWith('task1');
  });

  it('should handle editing flow', async () => {
    const { taskService } = await import('@/services/task-service');
    const { useTaskStore } = await import('@/stores/task-store');

    const mockTask = { id: 'task1', title: 'Original Title' };
    const mockGetTask = vi.fn().mockReturnValue(mockTask);
    (useTaskStore as any).getState = vi.fn().mockReturnValue({
      getTask: mockGetTask,
      setCurrentTaskId: vi.fn(),
    });

    // Mock finishEditing to return result
    mockUIStateStoreState.finishEditing = vi.fn().mockReturnValue({
      taskId: 'task1',
      title: 'New Title',
    });

    const { result } = renderHook(() => useTasks());

    // Start editing
    const mockEvent = { stopPropagation: vi.fn() };
    act(() => {
      result.current.startEditing(mockTask as any, mockEvent as any);
    });

    expect(mockUIStateStoreState.startEditing).toHaveBeenCalledWith(mockTask, mockEvent);

    // Finish editing
    await act(async () => {
      await result.current.finishEditing();
    });

    expect(taskService.renameTask).toHaveBeenCalledWith('task1', 'New Title');
  });

  it('should cancel editing', () => {
    const { result } = renderHook(() => useTasks());

    act(() => {
      result.current.cancelEditing();
    });

    expect(mockUIStateStoreState.cancelEditing).toHaveBeenCalled();
  });
});
