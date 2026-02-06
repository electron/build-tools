import { execSync } from 'child_process';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const { ensurePrereqs, ensureTestPrereqs } = require('../src/utils/prereqs');

// Store original platform
const originalPlatform = process.platform;

/**
 * Helper to mock process.platform
 */
function mockPlatform(platform) {
  Object.defineProperty(process, 'platform', {
    value: platform,
    writable: true,
    configurable: true,
  });
}

/**
 * Helper to restore process.platform
 */
function restorePlatform() {
  Object.defineProperty(process, 'platform', {
    value: originalPlatform,
    writable: true,
    configurable: true,
  });
}

describe('prereqs', () => {
  describe('ensureTestPrereqs', () => {
    afterAll(() => {
      restorePlatform();
    });

    it('should skip checks on non-Linux platforms', () => {
      // Mock process.platform to be darwin (macOS)
      mockPlatform('darwin');

      // Should not throw on non-Linux
      expect(() => ensureTestPrereqs()).not.toThrow();

      // Mock process.platform to be win32 (Windows)
      mockPlatform('win32');

      // Should not throw on non-Linux
      expect(() => ensureTestPrereqs()).not.toThrow();

      restorePlatform();
    });

    it('should check for required Python modules on Linux', () => {
      // Only run this test on Linux
      if (originalPlatform !== 'linux') {
        return;
      }

      // Check if dbusmock is available
      let dbusmockAvailable = false;
      try {
        execSync('python3 -c "import dbusmock"', { stdio: 'pipe' });
        dbusmockAvailable = true;
      } catch {
        dbusmockAvailable = false;
      }

      // Check if gi is available
      let giAvailable = false;
      try {
        execSync('python3 -c "import gi"', { stdio: 'pipe' });
        giAvailable = true;
      } catch {
        giAvailable = false;
      }

      // If both modules are available, ensureTestPrereqs should not throw
      // If any module is missing, it should throw with a helpful message
      if (dbusmockAvailable && giAvailable) {
        expect(() => ensureTestPrereqs()).not.toThrow();
      } else {
        // We expect it to exit with a fatal error
        // Since fatal calls process.exit, we need to mock it
        const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
          throw new Error('process.exit called');
        });
        const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => ensureTestPrereqs()).toThrow('process.exit called');

        // Verify the error message contains helpful information
        expect(mockError).toHaveBeenCalled();
        const errorCall = mockError.mock.calls[0][0];

        if (!dbusmockAvailable) {
          expect(errorCall).toContain('python-dbusmock');
        }
        if (!giAvailable) {
          expect(errorCall).toContain('PyGObject');
        }

        mockExit.mockRestore();
        mockError.mockRestore();
      }
    });
  });
});
