import { describe, it, expect } from 'vitest';

import { parseTranslate, formatTranslate } from './edit-mode-layer.jsx';

describe('move helpers (CSS translate)', () => {
  it('parses plain px translate values', () => {
    expect(parseTranslate('none')).toEqual([0, 0]);
    expect(parseTranslate('')).toEqual([0, 0]);
    expect(parseTranslate('12px')).toEqual([12, 0]);
    expect(parseTranslate('12px -8.5px')).toEqual([12, -8.5]);
  });

  it('refuses values it cannot safely add to', () => {
    expect(parseTranslate('10%')).toBeNull();
    expect(parseTranslate('calc(1px + 2px) 0px')).toBeNull();
  });

  it('rounds to whole px and removes the key at the origin', () => {
    expect(formatTranslate(12.4, -8.6)).toBe('12px -9px');
    expect(formatTranslate(0.2, -0.3)).toBeUndefined();
  });
});
