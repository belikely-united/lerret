// model-asset-card.jsx — draws one 3D model (`.glb` / `.gltf` / `.stl` /
// `.obj`) inside its artboard (spec-3d-models.md).
//
// On the canvas it is a plain still (rendered by the runtime), so export and
// big pages stay cheap. Opened in focus view it swaps in a live view you can
// rotate — one WebGL context, released when focus closes.

import { useEffect, useRef, useState } from 'react';
import { mountModelViewer } from '../../runtime/model-render.js';

/**
 * @param {object} props
 * @param {string} props.image  PNG data URL of the rendered model.
 * @param {object} props.model  What the live view needs to re-render it.
 * @returns {React.ReactElement}
 */
export function ModelAssetCard({ image, model }) {
  const ref = useRef(null);
  const [live, setLive] = useState(false);

  // Live only inside focus view (rendered into the focus overlay's portal).
  useEffect(() => {
    if (!ref.current?.closest('.dc-focus-overlay')) return undefined;
    let cleanup = null;
    let gone = false;
    mountModelViewer(ref.current, model)
      .then((stop) => { if (gone) stop(); else { cleanup = stop; setLive(true); } })
      .catch(() => {}); // the still stays — it already shows the model
    return () => { gone = true; cleanup?.(); };
  }, [model]);

  return (
    <div
      ref={ref}
      data-asset-kind="model"
      title={live ? 'Drag to rotate · scroll to zoom' : undefined}
      style={{ position: 'relative', width: '100%', height: '100%', background: model.background }}
    >
      <img
        src={image}
        alt=""
        draggable={false}
        style={{ display: live ? 'none' : 'block', width: '100%', height: '100%' }}
      />
    </div>
  );
}

export default ModelAssetCard;
