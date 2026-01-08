// src/services/database/recent-projects-service.ts

import { logger } from '@/lib/logger';
import type { TursoClient } from './turso-client';

/**
 * Check if an error is a UNIQUE constraint violation
 * Handles different error formats from various SQLite drivers
 */
function isUniqueConstraintError(error: unknown): boolean {
  if (!error) return false;

  // Check error code (some drivers use this)
  if (typeof error === 'object') {
    const err = error as { code?: string; errno?: number; message?: string };
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
    if (err.errno === 2067) return true;
    // Check error message (libsql uses this format)
    if (err.message?.includes('UNIQUE constraint failed')) return true;
  }

  // Check if error is a string or has toString
  const errorStr = String(error);
  if (errorStr.includes('UNIQUE constraint failed')) return true;

  return false;
}

export interface RecentProject {
  id: number;
  project_id: string;
  project_name: string;
  root_path: string;
  opened_at: number;
}

export class RecentProjectsService {
  private readonly MAX_RECENT_PROJECTS = 10;

  constructor(private db: TursoClient) {}

  /**
   * Track a project being opened
   * If the project already exists in recent list, update its opened_at timestamp
   */
  async trackProjectOpened(
    projectId: string,
    projectName: string,
    rootPath: string
  ): Promise<void> {
    try {
      const now = Date.now();

      // Use a two-step approach to handle concurrency:
      // 1. Try to update existing entry
      const updateResult = await this.db.execute(
        'UPDATE recent_projects SET opened_at = ?, project_name = ? WHERE project_id = ?',
        [now, projectName, projectId]
      );

      // 2. If no rows were updated, insert new entry
      const updated = updateResult.rowsAffected && updateResult.rowsAffected > 0;

      if (!updated) {
        try {
          await this.db.execute(
            'INSERT INTO recent_projects (project_id, project_name, root_path, opened_at) VALUES (?, ?, ?, ?)',
            [projectId, projectName, rootPath, now]
          );
        } catch (insertError: unknown) {
          // If insert fails due to UNIQUE constraint (concurrent insert), try update again
          if (isUniqueConstraintError(insertError)) {
            await this.db.execute(
              'UPDATE recent_projects SET opened_at = ?, project_name = ? WHERE project_id = ?',
              [now, projectName, projectId]
            );
          } else {
            throw insertError;
          }
        }

        // Only cleanup after a new insert when we're at or near the limit
        const count = await this.getProjectsCount();
        if (count > this.MAX_RECENT_PROJECTS) {
          await this.cleanupOldEntries();
        }
      }

      logger.info(`Tracked project opened: ${projectName} (${projectId})`);
    } catch (error) {
      logger.error('Failed to track recent project:', error);
      throw error;
    }
  }

  /**
   * Get recent projects, ordered by most recently opened
   */
  async getRecentProjects(limit = 5): Promise<RecentProject[]> {
    try {
      const effectiveLimit = Math.min(limit, this.MAX_RECENT_PROJECTS);

      const result = await this.db.select<RecentProject[]>(
        `SELECT id, project_id, project_name, root_path, opened_at
         FROM recent_projects
         ORDER BY opened_at DESC
         LIMIT ?`,
        [effectiveLimit]
      );

      return result;
    } catch (error) {
      logger.error('Failed to get recent projects:', error);
      throw error;
    }
  }

  /**
   * Remove a project from recent list (e.g., when project is deleted)
   */
  async removeProject(projectId: string): Promise<void> {
    try {
      await this.db.execute('DELETE FROM recent_projects WHERE project_id = ?', [projectId]);
      logger.info(`Removed project from recent list: ${projectId}`);
    } catch (error) {
      logger.error('Failed to remove recent project:', error);
      throw error;
    }
  }

  /**
   * Clear all recent projects
   */
  async clearRecentProjects(): Promise<void> {
    try {
      await this.db.execute('DELETE FROM recent_projects', []);
      logger.info('Cleared all recent projects');
    } catch (error) {
      logger.error('Failed to clear recent projects:', error);
      throw error;
    }
  }

  /**
   * Get the count of recent projects
   */
  private async getProjectsCount(): Promise<number> {
    try {
      const result = await this.db.select<Array<{ count: number }>>(
        'SELECT COUNT(*) as count FROM recent_projects',
        []
      );
      return result[0]?.count ?? 0;
    } catch (error) {
      logger.error('Failed to get recent projects count:', error);
      return 0;
    }
  }

  /**
   * Clean up old entries, keeping only the most recent MAX_RECENT_PROJECTS
   */
  private async cleanupOldEntries(): Promise<void> {
    try {
      await this.db.execute(
        `DELETE FROM recent_projects
         WHERE rowid IN (
           SELECT rowid FROM recent_projects
           ORDER BY opened_at DESC
           LIMIT -1 OFFSET ?
         )`,
        [this.MAX_RECENT_PROJECTS]
      );
    } catch (error) {
      logger.error('Failed to cleanup old recent projects:', error);
      // Don't throw - this is a background cleanup operation
    }
  }
}
