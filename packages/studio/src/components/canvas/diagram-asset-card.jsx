// diagram-asset-card.jsx — draws one rendered Mermaid diagram (`.mmd` /
// `.mermaid`) inside its artboard (spec-mermaid-diagrams.md, Phase 1).
//
// The SVG is already rendered by the runtime (`runtime/diagram-render.js`),
// so this is a plain synchronous component: the artboard is sized to the
// diagram + padding, and the SVG fills the box inside the padding.

import { DIAGRAM_PADDING } from '../../runtime/diagram-render.js';

/**
 * @param {object} props
 * @param {string} [props.svg]  Rendered SVG markup (Mermaid output,
 *   sanitized by Mermaid's `securityLevel: 'strict'`). Empty → empty state.
 * @param {string} [props.background]  Card colour — the brand background.
 * @returns {React.ReactElement}
 */
export function DiagramAssetCard({ svg, background = '#FFFFFF' }) {
  if (!svg) {
    return (
      <div
        data-asset-kind="diagram"
        style={{
          width: '100%', height: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'center', background, color: '#A3A3A3',
          fontFamily: 'var(--lm-font-sans, sans-serif)', fontSize: 12, fontStyle: 'italic',
        }}
      >
        Empty diagram
      </div>
    );
  }
  return (
    <div
      data-asset-kind="diagram"
      className="lm-diagram"
      style={{ width: '100%', height: '100%', boxSizing: 'border-box', padding: DIAGRAM_PADDING, background }}
      // Mermaid's own output, rendered under securityLevel 'strict'.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default DiagramAssetCard;
