// Tests for the `FilesystemAccess` contract helpers — the JSON serializer and
// the structural conformance validator. The contract itself is JSDoc types;
// what runs (and is tested here) is `serializeJson` + the validator family.

import { describe, it, expect } from 'vitest';

import {
  serializeJson,
  assertFilesystemContract,
  findFilesystemContractViolations,
  isFilesystemAccess,
} from './filesystem.js';

/**
 * A minimal object that structurally satisfies the contract — methods present,
 * capability flags all boolean. Behavior is irrelevant to the *structural*
 * validator.
 *
 * @returns {import('./filesystem.js').FilesystemAccess}
 */
function makeConformingBackend() {
  return {
    readDir: async () => [],
    readFile: async () => '',
    writeFile: async () => {},
    watch: () => ({ close() {} }),
    capabilities: { canWrite: true, canWatch: true, canReveal: false },
  };
}

describe('serializeJson', () => {
  it('emits two-space indentation and a single trailing newline', () => {
    const out = serializeJson({ liveRefresh: true });
    expect(out).toBe('{\n  "liveRefresh": true\n}\n');
    expect(out.endsWith('\n')).toBe(true);
    // Exactly one trailing newline — no double.
    expect(out.endsWith('\n\n')).toBe(false);
  });

  it('is deterministic — identical input yields byte-identical output', () => {
    const value = { b: 2, a: 1, nested: { y: true, x: false } };
    expect(serializeJson(value)).toBe(serializeJson(value));
  });

  it('preserves key insertion order for stable git diffs', () => {
    const out = serializeJson({ colors: {}, fonts: {}, dimensions: {} });
    expect(out.indexOf('colors')).toBeLessThan(out.indexOf('fonts'));
    expect(out.indexOf('fonts')).toBeLessThan(out.indexOf('dimensions'));
  });
});

describe('findFilesystemContractViolations', () => {
  it('returns no violations for a conforming backend', () => {
    expect(findFilesystemContractViolations(makeConformingBackend())).toEqual(
      [],
    );
  });

  it('rejects a non-object', () => {
    expect(findFilesystemContractViolations(null)).toContain(
      'backend is not an object',
    );
    expect(findFilesystemContractViolations(42)).toContain(
      'backend is not an object',
    );
  });

  it('flags each missing method', () => {
    const backend = makeConformingBackend();
    delete backend.writeFile;
    const problems = findFilesystemContractViolations(backend);
    expect(problems).toContain('missing or non-function method: writeFile()');
  });

  it('flags a method that is present but not a function', () => {
    const backend = makeConformingBackend();
    backend.readDir = 'not a function';
    expect(findFilesystemContractViolations(backend)).toContain(
      'missing or non-function method: readDir()',
    );
  });

  it('flags a missing capabilities object', () => {
    const backend = makeConformingBackend();
    delete backend.capabilities;
    expect(findFilesystemContractViolations(backend)).toContain(
      'missing or invalid `capabilities` object',
    );
  });

  it('flags a non-boolean capability flag', () => {
    const backend = makeConformingBackend();
    backend.capabilities = { canWrite: true, canWatch: 'yes', canReveal: true };
    expect(findFilesystemContractViolations(backend)).toContain(
      'capabilities.canWatch must be a boolean',
    );
  });

  it('reports every problem at once, not just the first', () => {
    const problems = findFilesystemContractViolations({});
    // 4 missing methods + 1 missing capabilities object.
    expect(problems.length).toBe(5);
  });
});

describe('assertFilesystemContract', () => {
  it('returns the backend unchanged when it conforms', () => {
    const backend = makeConformingBackend();
    expect(assertFilesystemContract(backend)).toBe(backend);
  });

  it('throws an enumerating error when the backend does not conform', () => {
    expect(() => assertFilesystemContract({}, 'bad-backend')).toThrow(
      /bad-backend does not satisfy the FilesystemAccess contract/,
    );
  });

  it('lists every violation in the thrown message', () => {
    let message = '';
    try {
      assertFilesystemContract({});
    } catch (err) {
      message = err.message;
    }
    expect(message).toContain('readDir()');
    expect(message).toContain('writeFile()');
    expect(message).toContain('capabilities');
  });
});

describe('isFilesystemAccess', () => {
  it('is true for a conforming backend and false otherwise', () => {
    expect(isFilesystemAccess(makeConformingBackend())).toBe(true);
    expect(isFilesystemAccess({})).toBe(false);
    expect(isFilesystemAccess(null)).toBe(false);
  });
});
