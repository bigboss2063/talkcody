import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BashToolResult } from './bash-tool-result';
import React from 'react';

describe('BashToolResult', () => {
  describe('basic rendering', () => {
    it('should display output when provided', () => {
      const { container } = render(
        <BashToolResult
          output="Command completed"
          success={true}
        />
      );

      // When output is provided, it should be displayed
      const preElement = container.querySelector('pre');
      expect(preElement?.textContent).toContain('Command completed');
    });

    it('should display error when provided', () => {
      const { container } = render(
        <BashToolResult
          error="Error occurred"
          success={false}
        />
      );

      const preElement = container.querySelector('pre');
      expect(preElement?.textContent).toContain('Error occurred');
    });

    it('should display output content on multiple lines', () => {
      render(
        <BashToolResult
          output="Line 1\nLine 2\nLine 3"
          success={true}
        />
      );

      expect(screen.getByText((content) => content.includes('Line 1'))).toBeInTheDocument();
      expect(screen.getByText((content) => content.includes('Line 2'))).toBeInTheDocument();
      expect(screen.getByText((content) => content.includes('Line 3'))).toBeInTheDocument();
    });

    it('should prefer output over error for display', () => {
      render(
        <BashToolResult
          output="Standard output"
          error="Error output"
          success={true}
        />
      );

      const preElement = document.querySelector('pre');
      expect(preElement?.textContent).toContain('Standard output');
    });

    it('should show default message when no output or error', () => {
      const { container } = render(
        <BashToolResult
          success={true}
        />
      );

      const preElement = container.querySelector('pre');
      expect(preElement?.textContent).toContain('Command executed successfully');
    });

    it('should show failure message when no output or error on failure', () => {
      const { container } = render(
        <BashToolResult
          success={false}
        />
      );

      const preElement = container.querySelector('pre');
      expect(preElement?.textContent).toContain('Command execution failed');
    });
  });

  describe('outputFile handling', () => {
    it('should show file notification when outputFile is provided', () => {
      const { container } = render(
        <BashToolResult
          outputFile="/path/to/output.log"
          success={true}
        />
      );

      expect(container.textContent).toContain('Full output saved to file');
      expect(container.textContent).toContain('/path/to/output.log');
    });

    it('should show file notification when errorFile is provided', () => {
      const { container } = render(
        <BashToolResult
          errorFile="/path/to/error.log"
          success={false}
        />
      );

      expect(container.textContent).toContain('Full output saved to file');
      expect(container.textContent).toContain('/path/to/error.log');
    });

    it('should display outputFile notification icon', () => {
      const { container } = render(
        <BashToolResult
          outputFile="/path/to/output.log"
          success={true}
        />
      );

      // Should have an SVG icon (FileText)
      const svgIcons = container.querySelectorAll('svg');
      expect(svgIcons.length).toBeGreaterThan(0);
    });

    it('should not show file notification when no outputFile/errorFile', () => {
      const { container } = render(
        <BashToolResult
          output="Short output"
          success={true}
        />
      );

      expect(container.textContent).not.toContain('Full output saved to file');
    });
  });

  describe('idle timeout handling', () => {
    it('should show running in background message when idle timed out', () => {
      const { container } = render(
        <BashToolResult
          output="Server started on port 3000"
          success={true}
          idleTimedOut={true}
          pid={12345}
        />
      );

      expect(container.textContent).toContain('Process running in background');
      expect(container.textContent).toContain('12345');
    });
  });

  describe('max timeout handling', () => {
    it('should show timed out message', () => {
      const { container } = render(
        <BashToolResult
          output="Partial output"
          success={true}
          timedOut={true}
          pid={67890}
        />
      );

      expect(container.textContent).toContain('Command timed out');
      expect(container.textContent).toContain('67890');
    });
  });

  describe('exit code display', () => {
    it('should not show exit code in output (exit code is metadata)', () => {
      const { container } = render(
        <BashToolResult
          success={false}
        />
      );

      // Exit code is not displayed in the output, only as metadata
      const preElement = container.querySelector('pre');
      expect(preElement?.textContent).not.toContain('Exit code:');
    });
  });

  describe('output display styling', () => {
    it('should display output in a pre element', () => {
      const { container } = render(
        <BashToolResult
          output="Line 1\nLine 2\nLine 3"
          success={true}
        />
      );

      const preElement = container.querySelector('pre');
      expect(preElement).toBeInTheDocument();
    });

    it('should preserve whitespace in output', () => {
      const { container } = render(
        <BashToolResult
          output="  indented line\n    double indented"
          success={true}
        />
      );

      const preElement = container.querySelector('pre');
      expect(preElement?.textContent).toContain('indented line');
      expect(preElement?.textContent).toContain('double indented');
    });
  });

  describe('edge cases', () => {
    it('should handle undefined output gracefully', () => {
      const { container } = render(
        <BashToolResult
          success={true}
        />
      );

      // Should show default success message
      const preElement = container.querySelector('pre');
      expect(preElement?.textContent).toContain('Command executed successfully');
    });

    it('should handle empty output string', () => {
      const { container } = render(
        <BashToolResult
          output=""
          success={true}
        />
      );

      // Empty string is falsy, should show default message
      const preElement = container.querySelector('pre');
      expect(preElement?.textContent).toContain('Command executed successfully');
    });

    it('should handle both outputFile and errorFile', () => {
      const { container } = render(
        <BashToolResult
          outputFile="/path/to/output.log"
          errorFile="/path/to/error.log"
          success={false}
        />
      );

      // outputFile is always shown, errorFile is shown as file notification
      // The component shows: outputFile takes precedence for file notification
      expect(container.textContent).toContain('/path/to/output.log');
    });

    it('should handle outputFile only', () => {
      const { container } = render(
        <BashToolResult
          outputFile="/path/to/output.log"
          success={true}
        />
      );

      expect(container.textContent).toContain('/path/to/output.log');
    });

    it('should handle errorFile only', () => {
      const { container } = render(
        <BashToolResult
          errorFile="/path/to/error.log"
          success={false}
        />
      );

      expect(container.textContent).toContain('/path/to/error.log');
    });
  });

  describe('large output message', () => {
    it('should display truncated message in output', () => {
      const { container } = render(
        <BashToolResult
          output="... (500 lines truncated)\nLast line of output"
          success={true}
        />
      );

      const preElement = container.querySelector('pre');
      expect(preElement?.textContent).toContain('500 lines truncated');
      expect(preElement?.textContent).toContain('Last line of output');
    });
  });

  describe('output notification styling', () => {
    it('should have terminal icon in output section', () => {
      const { container } = render(
        <BashToolResult
          output="test"
          success={true}
        />
      );

      const terminalIcon = container.querySelector('.lucide-terminal');
      expect(terminalIcon).toBeInTheDocument();
    });

    it('should have labeled output section', () => {
      const { container } = render(
        <BashToolResult
          output="test"
          success={true}
        />
      );

      expect(container.textContent).toContain('Output:');
    });
  });
});
