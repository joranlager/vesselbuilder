// Entry for public/vendor/three-io.js: model loaders and the glTF exporter, for the ship inspector's
// vessel models (upload, download, the vessels folder). It imports three.js from ./three.js (the
// same module the rest of the app uses), so there is one copy of three.js on the page.
export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
export { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
export { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
export { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
// More of the usual model files people have, for the ship builder's uploads.
export { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
export { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
export { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
export { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
