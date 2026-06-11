// @vitest-environment node
//
// Unit tests for the W3 social-variant planner (Story 8.8, Task 4). Pins the
// three-stage append contract from the spec's adversarial-review note:
//   1. the EXACT pre-existing keys survive with untouched values,
//   2. the new keys are present, unique, collision-free,
//   3. exactly ONE .data.json write step and ZERO .jsx writes are emitted —
// plus brand-prop anchoring, prompt-derived copy, the core last-dot stem
// rule, and graceful degradation for a missing data file.

import { describe, it, expect, vi } from 'vitest';

import { planSocialVariants } from './social-variants.js';
import {
  createInMemoryFs,
  createMockSandbox,
  seedFs,
} from '../../snapshot/__test-helpers__/in-memory-fs.js';

const ROOT = '/proj';

/** The canonical named-export-variant shape (appstore screenshot precedent). */
const EXISTING = Object.freeze({
  default: {
    eyebrow: '01 / canvas',
    headline: 'Designs are just files.',
    brandColor: '#OLD000',
  },
  Features: { eyebrow: '02 / features', headline: 'Edit. Save. Render.' },
  Data: { eyebrow: '03 / data', headline: 'Props you can git diff.' },
});

const TOKENS = Object.freeze({ brand: '#B85B33', accent: '#F1EDE5' });

function makeWorld(files = {}) {
  const fs = createInMemoryFs();
  seedFs(
    fs,
    Object.fromEntries(Object.entries(files).map(([p, c]) => [`${ROOT}/${p}`, c])),
  );
  return { fs, sandbox: createMockSandbox(fs, ROOT) };
}

const REF = 'social-media/twitter/launch-1.jsx';
const DATA_PATH = '.lerret/social-media/twitter/launch-1.data.json';

/** The reference COMPONENT itself — the planner probes its existence before
 * planning (a missing reference yields an empty plan), so every world that
 * expects a plan seeds it. */
const REF_JSX = Object.freeze({ [`.lerret/${REF}`]: '// hand-authored reference component' });

describe('planSocialVariants — the append contract (AC-6)', () => {
  it('appends count new keys onto the EXISTING map: old keys + values survive byte-for-byte', async () => {
    const { sandbox } = makeWorld({ ...REF_JSX, [DATA_PATH]: JSON.stringify(EXISTING) });
    const steps = await planSocialVariants({
      prompt: `three more social posts in the same style as ${REF}`,
      reference: { path: REF, count: 3 },
      brandTokens: TOKENS,
      fs: sandbox,
    });

    expect(steps).toHaveLength(1);
    const merged = JSON.parse(steps[0].content);

    // Stage 1 — the EXACT pre-existing keys survive, values untouched.
    expect(merged.default).toEqual(EXISTING.default);
    expect(merged.Features).toEqual(EXISTING.Features);
    expect(merged.Data).toEqual(EXISTING.Data);

    // Stage 2 — exactly three new, unique keys (numbered after the 3 existing).
    const newKeys = Object.keys(merged).filter((k) => !(k in EXISTING));
    expect(newKeys).toEqual(['Variant4', 'Variant5', 'Variant6']);
    expect(Object.keys(merged)).toHaveLength(6);

    // Stage 3 — ONE .data.json write, ZERO .jsx writes.
    expect(steps[0]).toMatchObject({ op: 'write', path: DATA_PATH });
    expect(steps.filter((s) => s.path.endsWith('.jsx'))).toHaveLength(0);
  });

  it('avoids key collisions: an existing VariantN is skipped, keys stay unique', async () => {
    const { sandbox } = makeWorld({
      ...REF_JSX,
      [DATA_PATH]: JSON.stringify({
        default: { headline: 'base' },
        Variant2: { headline: 'already here' },
      }),
    });
    const steps = await planSocialVariants({
      prompt: `two more in the same style as ${REF}`,
      reference: { path: REF, count: 2 },
      brandTokens: TOKENS,
      fs: sandbox,
    });
    const merged = JSON.parse(steps[0].content);

    expect(merged.Variant2).toEqual({ headline: 'already here' }); // untouched
    const newKeys = Object.keys(merged).filter(
      (k) => k !== 'default' && k !== 'Variant2',
    );
    expect(newKeys).toEqual(['Variant3', 'Variant4']); // 2 collided → skipped
    expect(new Set(Object.keys(merged)).size).toBe(Object.keys(merged).length);
  });

  it('emits the canonical serialized form (two-space indent + trailing newline)', async () => {
    const { sandbox } = makeWorld({ ...REF_JSX, [DATA_PATH]: JSON.stringify(EXISTING) });
    const [step] = await planSocialVariants({
      prompt: `variants of ${REF}`,
      reference: { path: REF },
      brandTokens: TOKENS,
      fs: sandbox,
    });
    expect(step.content.endsWith('\n')).toBe(true);
    expect(step.content).toBe(`${JSON.stringify(JSON.parse(step.content), null, 2)}\n`);
  });
});

describe('planSocialVariants — brand anchoring + prompt-derived copy', () => {
  it('new entries carry token-anchored brand props (drifted template hex re-anchored)', async () => {
    const { sandbox } = makeWorld({ ...REF_JSX, [DATA_PATH]: JSON.stringify(EXISTING) });
    const steps = await planSocialVariants({
      prompt: `three more social posts in the same style as ${REF}`,
      reference: { path: REF, count: 3 },
      brandTokens: TOKENS,
      fs: sandbox,
    });
    const merged = JSON.parse(steps[0].content);

    for (const key of ['Variant4', 'Variant5', 'Variant6']) {
      expect(merged[key].brandColor).toBe('#B85B33'); // token wins over '#OLD000'
      expect(merged[key].accentColor).toBe('#F1EDE5'); // injected from tokens
    }
    // The EXISTING default keeps its drifted value — append never rewrites it.
    expect(merged.default.brandColor).toBe('#OLD000');
  });

  it('the prompt topic lands on the copy-bearing prop, numbered for distinctness', async () => {
    const { sandbox } = makeWorld({ ...REF_JSX, [DATA_PATH]: JSON.stringify(EXISTING) });
    const steps = await planSocialVariants({
      prompt: `three more social posts in the same style as ${REF}`,
      reference: { path: REF, count: 3 },
      brandTokens: TOKENS,
      fs: sandbox,
    });
    const merged = JSON.parse(steps[0].content);

    expect(merged.Variant4.headline).toBe('social posts — 1');
    expect(merged.Variant5.headline).toBe('social posts — 2');
    expect(merged.Variant6.headline).toBe('social posts — 3');
    // Non-copy template props carry over from the reference shape.
    expect(merged.Variant4.eyebrow).toBe('01 / canvas');
  });

  it('a single variant takes the topic unnumbered', async () => {
    const { sandbox } = makeWorld({ ...REF_JSX, [DATA_PATH]: JSON.stringify(EXISTING) });
    const steps = await planSocialVariants({
      prompt: `another version of ${REF} for the plugin API teaser`,
      reference: { path: REF, count: 1 },
      brandTokens: TOKENS,
      fs: sandbox,
    });
    const merged = JSON.parse(steps[0].content);
    expect(merged.Variant4.headline).toBe('for the plugin API teaser');
  });

  it('an empty topic keeps the template copy (variants differ by key only)', async () => {
    const { sandbox } = makeWorld({ ...REF_JSX, [DATA_PATH]: JSON.stringify(EXISTING) });
    const steps = await planSocialVariants({
      prompt: `two more in the same style as ${REF}`,
      reference: { path: REF, count: 2 },
      brandTokens: TOKENS,
      fs: sandbox,
    });
    const merged = JSON.parse(steps[0].content);
    expect(merged.Variant4.headline).toBe('Designs are just files.');
    expect(merged.Variant5.headline).toBe('Designs are just files.');
  });

  it('uses the ds.resolveBrandTokens fallback seam when brandTokens is absent', async () => {
    const { sandbox } = makeWorld({ ...REF_JSX, [DATA_PATH]: JSON.stringify(EXISTING) });
    const ds = { resolveBrandTokens: vi.fn(async () => ({ brand: '#ABCDEF' })) };
    const steps = await planSocialVariants({
      prompt: `variants of ${REF}`,
      reference: { path: REF },
      ds,
      fs: sandbox,
    });
    expect(ds.resolveBrandTokens).toHaveBeenCalledTimes(1);
    const merged = JSON.parse(steps[0].content);
    expect(merged.Variant4.brandColor).toBe('#ABCDEF');
  });
});

describe('planSocialVariants — path handling (the core co-location rule)', () => {
  it('normalizes a bare reference path to .lerret/ and targets the last-dot stem data file', async () => {
    const { sandbox } = makeWorld({ ...REF_JSX, [DATA_PATH]: JSON.stringify(EXISTING) });
    const [step] = await planSocialVariants({
      prompt: `variants of ${REF}`,
      reference: { path: REF },
      brandTokens: TOKENS,
      fs: sandbox,
    });
    expect(step.path).toBe(DATA_PATH);
  });

  it('keeps an already-prefixed .lerret/ reference unchanged', async () => {
    const { sandbox } = makeWorld({ ...REF_JSX, [DATA_PATH]: JSON.stringify(EXISTING) });
    const [step] = await planSocialVariants({
      prompt: 'variants of .lerret/social-media/twitter/launch-1.jsx',
      reference: { path: '.lerret/social-media/twitter/launch-1.jsx' },
      brandTokens: TOKENS,
      fs: sandbox,
    });
    expect(step.path).toBe(DATA_PATH);
  });

  it('stems at the LAST dot exactly like core (Card.v2.jsx → Card.v2.data.json)', async () => {
    const { sandbox } = makeWorld({
      '.lerret/social-media/twitter/Card.v2.jsx': '// reference component',
      '.lerret/social-media/twitter/Card.v2.data.json': JSON.stringify({
        default: { headline: 'x' },
      }),
    });
    const [step] = await planSocialVariants({
      prompt: 'variants of social-media/twitter/Card.v2.jsx',
      reference: { path: 'social-media/twitter/Card.v2.jsx' },
      brandTokens: TOKENS,
      fs: sandbox,
    });
    expect(step.path).toBe('.lerret/social-media/twitter/Card.v2.data.json');
    const merged = JSON.parse(step.content);
    expect(merged.default).toEqual({ headline: 'x' }); // the seeded file WAS read
  });

  it('accepts a bare string reference (recognizer-object optional)', async () => {
    const { sandbox } = makeWorld({ ...REF_JSX, [DATA_PATH]: JSON.stringify(EXISTING) });
    const [step] = await planSocialVariants({
      prompt: `variants of ${REF}`,
      reference: REF,
      brandTokens: TOKENS,
      fs: sandbox,
    });
    expect(step.path).toBe(DATA_PATH);
    expect(Object.keys(JSON.parse(step.content))).toHaveLength(6);
  });

  it('throws TypeError for a missing reference path (programming error, loud)', async () => {
    await expect(planSocialVariants({ prompt: 'variants of nothing' })).rejects.toThrow(
      TypeError,
    );
    await expect(
      planSocialVariants({ prompt: 'x', reference: { count: 2 } }),
    ).rejects.toThrow(TypeError);
  });
});

describe('planSocialVariants — count + graceful degradation', () => {
  it('explicit count param wins over reference.count; invalid counts default to 3; cap at 20', async () => {
    const { sandbox } = makeWorld({ ...REF_JSX, [DATA_PATH]: JSON.stringify(EXISTING) });
    const countOf = async (args) => {
      const [step] = await planSocialVariants({
        prompt: `variants of ${REF}`,
        reference: { path: REF, count: 5 },
        brandTokens: TOKENS,
        fs: sandbox,
        ...args,
      });
      return Object.keys(JSON.parse(step.content)).length - 3; // minus existing
    };
    expect(await countOf({ count: 2 })).toBe(2); // explicit wins
    expect(await countOf({})).toBe(5); // reference.count
    expect(await countOf({ count: 0, reference: { path: REF } })).toBe(3); // default
    expect(await countOf({ count: 999 })).toBe(20); // cap
  });

  it('a missing data file degrades gracefully: still ONE data write, ZERO .jsx writes', async () => {
    const { sandbox } = makeWorld({ ...REF_JSX }); // reference exists, no data file seeded
    const steps = await planSocialVariants({
      prompt: `two more in the same style as ${REF} about the beta`,
      reference: { path: REF, count: 2 },
      brandTokens: TOKENS,
      fs: sandbox,
    });
    expect(steps).toHaveLength(1);
    expect(steps[0].path).toBe(DATA_PATH);
    const merged = JSON.parse(steps[0].content);
    expect(Object.keys(merged)).toEqual(['Variant1', 'Variant2']);
    expect(merged.Variant1.brandColor).toBe('#B85B33'); // brand still anchored
  });

  it('a malformed existing data file is treated as empty — the plan never throws', async () => {
    const { sandbox } = makeWorld({ ...REF_JSX, [DATA_PATH]: '{ not json' });
    const steps = await planSocialVariants({
      prompt: `variants of ${REF}`,
      reference: { path: REF },
      brandTokens: TOKENS,
      fs: sandbox,
    });
    expect(steps).toHaveLength(1);
    expect(Object.keys(JSON.parse(steps[0].content))).toEqual([
      'Variant1',
      'Variant2',
      'Variant3',
    ]);
  });
});

describe('planSocialVariants — re-anchor is hex-literal-only (copy props survive)', () => {
  it('a font token whose canon collides with a copy prop does NOT clobber the copy', async () => {
    // canonToken strips a trailing 'font': the brand token `headlinefont`
    // canons to `headline` — the exact canon the COPY prop carries. Only a
    // hex-color current value may be re-anchored; copy text must stand.
    const { sandbox } = makeWorld({
      ...REF_JSX,
      [DATA_PATH]: JSON.stringify({
        default: {
          headline: 'Hand-written copy.',
          body: 'Long-form body copy.',
          accent: '#123456', // genuinely drifted hex — MUST still re-anchor
          brandColor: '#OLD000',
        },
      }),
    });
    const steps = await planSocialVariants({
      prompt: `two more in the same style as ${REF}`, // empty topic → template copy stands
      reference: { path: REF, count: 2 },
      brandTokens: { headlinefont: 'Inter Display', body: 'Geist', brand: '#B85B33', accent: '#F1EDE5' },
      fs: sandbox,
    });
    const merged = JSON.parse(steps[0].content);

    for (const key of ['Variant2', 'Variant3']) {
      // Copy props keep their text — neither font token lands on them.
      expect(merged[key].headline).toBe('Hand-written copy.');
      expect(merged[key].body).toBe('Long-form body copy.');
      // A hex-literal template value still re-anchors to the token…
      expect(merged[key].accent).toBe('#F1EDE5');
      // …and the BRAND_PROP_KEYS injection still applies regardless.
      expect(merged[key].brandColor).toBe('#B85B33');
    }
  });

  it('the prompt-derived topic survives a colliding font token too', async () => {
    const { sandbox } = makeWorld({ ...REF_JSX, [DATA_PATH]: JSON.stringify(EXISTING) });
    const steps = await planSocialVariants({
      prompt: `three more social posts in the same style as ${REF}`,
      reference: { path: REF, count: 3 },
      brandTokens: { ...TOKENS, headlinefont: 'Inter Display' },
      fs: sandbox,
    });
    const merged = JSON.parse(steps[0].content);
    expect(merged.Variant4.headline).toBe('social posts — 1'); // not 'Inter Display'
  });
});

describe('planSocialVariants — reference existence probe', () => {
  it('a nonexistent reference component yields an EMPTY plan (no fabricated data file)', async () => {
    const { sandbox } = makeWorld(); // nothing seeded — the reference is absent
    const steps = await planSocialVariants({
      prompt: `variants of ${REF}`,
      reference: { path: REF },
      brandTokens: TOKENS,
      fs: sandbox,
    });
    expect(steps).toEqual([]);
  });

  it('a throwing existence probe (traversal reference) degrades to the empty plan', async () => {
    const { sandbox } = makeWorld(); // the sandbox throws SandboxViolation on traversal
    const steps = await planSocialVariants({
      prompt: 'variants of ../../outside/evil.jsx',
      reference: { path: '../../outside/evil.jsx' },
      brandTokens: TOKENS,
      fs: sandbox,
    });
    expect(steps).toEqual([]);
  });
});
