// model-render.js — turns a 3D file (`.glb` / `.gltf` / `.stl` / `.obj`) into a
// still image, and mounts a live orbit view for focus mode (spec-3d-models.md).
//
// Same shape as diagram-render.js: the runtime renders BEFORE the entry
// exists, so a model is a plain fixed-size artboard showing an <img>. That
// keeps export simple (html-to-image can't read a WebGL canvas) and keeps the
// canvas to ONE shared WebGL context however many models a page holds
// (browsers cap live contexts at ~16). Only focus view opens a live context.
//
// three.js (MIT) and its loaders are imported lazily: projects without 3D
// files never download them.

/** Every model artboard's size (4:3). Per-model size is a later phase. */
export const MODEL_SIZE = Object.freeze({ width: 1024, height: 768 });

/** Look with no brand: light grey stage, mid-grey model. */
export const MODEL_NEUTRAL = Object.freeze({ background: '#F4F4F5', color: '#9A9AA3' });

/** The still is drawn at 2× so zooming in on the canvas stays sharp. */
const STILL_SCALE = 2;

let libPromise = null;
/** three.js + the addons we use, loaded once. */
function loadThree() {
  libPromise ??= Promise.all([
    import('three'),
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/STLLoader.js'),
    import('three/addons/loaders/OBJLoader.js'),
    import('three/addons/environments/RoomEnvironment.js'),
    import('three/addons/utils/BufferGeometryUtils.js'),
  ]).then(([THREE, gltf, stl, obj, room, utils]) => ({
    THREE,
    GLTFLoader: gltf.GLTFLoader,
    STLLoader: stl.STLLoader,
    OBJLoader: obj.OBJLoader,
    RoomEnvironment: room.RoomEnvironment,
    toCreasedNormals: utils.toCreasedNormals,
  }));
  return libPromise;
}

/** Lower-case extension of a file name, with the dot (`'.glb'`). */
export function modelExt(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

const decode = (bytes) => new TextDecoder().decode(bytes);

/** Join a folder and a relative path (`./`, `../` aware). Pure. */
function resolveIn(folder, rel) {
  const parts = folder.split('/').filter(Boolean);
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return (folder.startsWith('/') ? '/' : '') + parts.join('/');
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * A `.gltf` may point at side files (`scene.bin`, `wood.png`). Read each
 * relative one through the runtime and inline it as a data URL, so parsing
 * needs no server (works in CLI and hosted mode alike).
 *
 * @param {string} json  The `.gltf` text.
 * @param {string} folder  The `.gltf` file's folder.
 * @param {(path: string) => Promise<Uint8Array | null>} readFile
 * @returns {Promise<string>} The `.gltf` text with side files inlined.
 */
export async function inlineGltfResources(json, folder, readFile) {
  const doc = JSON.parse(json);
  for (const list of [doc.buffers, doc.images]) {
    for (const item of list || []) {
      const uri = item && item.uri;
      if (typeof uri !== 'string' || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(uri)) continue;
      const path = resolveIn(folder, decodeURIComponent(uri));
      const bytes = readFile ? await readFile(path) : null;
      if (!bytes) throw new Error(`Missing file "${uri}" (the .gltf points at it).`);
      item.uri = `data:${item.mimeType || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
    }
  }
  return JSON.stringify(doc);
}

/**
 * Parse a model file into a three.js object. Files without their own
 * materials (STL, OBJ) get a plain standard material in `color`.
 *
 * @param {object} lib  From loadThree().
 * @param {{ ext: string, bytes: Uint8Array, folder: string, color: string,
 *   readFile?: (path: string) => Promise<Uint8Array | null> }} model
 */
async function parseModel(lib, model) {
  if (!model.bytes || model.bytes.length === 0) throw new Error('The file is empty.');
  try {
    return await parseBytes(lib, model);
  } catch (err) {
    throw new Error(`Couldn't read this ${model.ext} file: ${err?.message || err}`);
  }
}

async function parseBytes(lib, model) {
  const { THREE } = lib;
  const { ext, bytes } = model;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const paint = () => new THREE.MeshStandardMaterial({ color: model.color, roughness: 0.55, metalness: 0.05 });

  if (ext === '.glb' || ext === '.gltf') {
    const data = ext === '.gltf' ? await inlineGltfResources(decode(bytes), model.folder, model.readFile) : buffer;
    const gltf = await new lib.GLTFLoader().parseAsync(data, '');
    return gltf.scene;
  }
  if (ext === '.stl') {
    // STL stores flat facets: smooth curved surfaces, keep edges sharper than 30°.
    const geometry = lib.toCreasedNormals(new lib.STLLoader().parse(buffer), Math.PI / 6);
    const mesh = new THREE.Mesh(geometry, paint());
    mesh.rotation.x = -Math.PI / 2; // STL is Z-up (print bed); three.js is Y-up
    return mesh;
  }
  if (ext === '.obj') {
    const group = new lib.OBJLoader().parse(decode(bytes));
    group.traverse((o) => { if (o.isMesh) o.material = paint(); });
    return group;
  }
  throw new Error(`Unsupported 3D file type "${ext}".`);
}

/**
 * Stage `object`: centre it, light it, and point a camera at it from a 3/4
 * view that fits the whole model.
 */
function stage(lib, renderer, object, look, aspect) {
  const { THREE } = lib;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(look.background);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new lib.RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(3, 5, 4);
  scene.add(key);

  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) throw new Error('The model has no visible geometry.');
  object.position.sub(box.getCenter(new THREE.Vector3()));
  scene.add(object);

  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  const camera = new THREE.PerspectiveCamera(30, aspect, radius / 100, radius * 100);
  const fit = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.copy(new THREE.Vector3(1, 0.6, 1.25).normalize().multiplyScalar(fit * 1.05));
  camera.lookAt(0, 0, 0);
  return { scene, camera };
}

function makeRenderer(THREE, canvas, preserve) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: preserve });
  } catch {
    throw new Error('3D preview needs WebGL, which is turned off in this browser.');
  }
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps brand colours true
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

/** Free a staged scene's GPU memory (geometries, materials, textures). */
function disposeScene(scene) {
  scene.environment?.dispose();
  scene.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
      m.dispose();
    }
  });
}

let still = null; // the one shared offscreen renderer for stills
let queue = Promise.resolve();

/**
 * Render a model once to a PNG data URL. Renders are serialized: they share
 * one offscreen WebGL context.
 *
 * @param {{ ext: string, bytes: Uint8Array, folder: string, background: string,
 *   color: string, readFile?: Function }} model
 * @param {{ width: number, height: number }} [size]
 * @returns {Promise<string>}
 */
export function renderModelStill(model, size = MODEL_SIZE) {
  const job = queue.then(async () => {
    const lib = await loadThree();
    still ??= makeRenderer(lib.THREE, document.createElement('canvas'), true);
    still.setPixelRatio(STILL_SCALE);
    still.setSize(size.width, size.height, false);
    const { scene, camera } = stage(lib, still, await parseModel(lib, model), model, size.width / size.height);
    try {
      still.render(scene, camera);
      return still.domElement.toDataURL('image/png');
    } finally {
      disposeScene(scene);
    }
  });
  queue = job.catch(() => {});
  return job;
}

/**
 * Mount a live, rotatable view of a model into `host` (focus view only).
 * Drag to orbit, scroll to zoom. Renders on demand, not every frame.
 *
 * @param {HTMLElement} host  Sized container; the canvas fills it.
 * @param {object} model  Same shape as {@link renderModelStill}.
 * @returns {Promise<() => void>} Cleanup — releases the WebGL context.
 */
export async function mountModelViewer(host, model) {
  const lib = await loadThree();
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab';
  const renderer = makeRenderer(lib.THREE, canvas, false);
  const { clientWidth: w, clientHeight: h } = host;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  const { scene, camera } = stage(lib, renderer, await parseModel(lib, model), model, w / h);
  const controls = new OrbitControls(camera, canvas);
  const draw = () => renderer.render(scene, camera);
  controls.addEventListener('change', draw);
  host.appendChild(canvas);
  draw();
  return () => {
    controls.dispose();
    disposeScene(scene);
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
}
