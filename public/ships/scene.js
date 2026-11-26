// Ship inspector: the three.js scene, camera, studio / ocean / underwater modes and the render loop.

import * as THREE from '../vendor/three.js';
import { OrbitControls, CSS2DRenderer, RoomEnvironment, Sky } from '../vendor/three.js';
import { buildCallouts, disposeCallouts } from './callouts.js';
import { Buoyancy, Ocean } from './ocean.js';

function causticTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * Math.PI * 2;
      const v = (y / S) * Math.PI * 2;
      let f = 0;
      f += Math.sin(u * 3 + Math.sin(v * 2) * 1.5);
      f += Math.sin(v * 4 + Math.sin(u * 3) * 1.2);
      f += Math.sin((u + v) * 2 + Math.cos(u * 5) * 0.8);
      const line = Math.pow(1 - Math.min(1, Math.abs(f) / 1.2), 6);
      const val = Math.round(40 + 215 * line);
      const i = (y * S + x) * 4;
      img.data[i] = val * 0.8;
      img.data[i + 1] = val;
      img.data[i + 2] = val;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export class ShipScene {
  host;
  renderer;
  labelRenderer;
  scene = new THREE.Scene();
  camera;
  controls;
  pivot = new THREE.Group();
  ocean = new Ocean();
  buoyancy = new Buoyancy();
  mode = 'studio';
  motion = true;
  ship = null;
  callouts = null;
  showCallouts = true;
  calloutArgs = null;
  sun = new THREE.DirectionalLight(0xffffff, 2.2);
  hemi = new THREE.HemisphereLight(0xdfeaff, 0x2a3440, 0.6);
  ground;
  grid;
  waterplane;
  sky = new Sky();
  pmrem;
  studioEnv;
  skyEnv = null;
  caustics;
  causticTex;
  snow;
  clock = new THREE.Clock();
  elapsed = 0;
  tween = null;
  raf = 0;
  ro;
  underwaterLook = false;
  sunElevation = 28;
  studioBg = new THREE.Color('#0d1b2a');
  underwaterColor = new THREE.Color('#0b4a5a');
  onUnderwaterChange;
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.labelRenderer = new CSS2DRenderer();
    const le = this.labelRenderer.domElement;
    le.style.position = 'absolute';
    le.style.inset = '0';
    le.style.pointerEvents = 'none';
    host.appendChild(le);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 60000);
    this.camera.position.set(220, 90, 260);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.addEventListener('start', () => (this.tween = null));
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.studioEnv = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.add(this.pivot);
    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.ShadowMaterial({ opacity: 0.35 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.grid = new THREE.GridHelper(2, 40, 0x2f5a7a, 0x1b3349);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.55;
    this.scene.add(this.grid);
    this.waterplane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x3fb6d8, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.waterplane.rotation.x = -Math.PI / 2;
    this.waterplane.name = 'waterplane';
    this.scene.add(this.waterplane);
    this.sky.scale.setScalar(45000);
    const su = this.sky.material.uniforms;
    su.turbidity.value = 6;
    su.rayleigh.value = 1.6;
    su.mieCoefficient.value = 0.005;
    su.mieDirectionalG.value = 0.8;
    this.scene.add(this.sky);
    this.scene.add(this.ocean.mesh);
    this.causticTex = causticTexture();
    this.caustics = new THREE.SpotLight(0x9fe8ff, 0, 0, Math.PI / 3.2, 0.4, 0);
    this.caustics.map = this.causticTex;
    this.caustics.castShadow = true;
    this.caustics.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.caustics, this.caustics.target);
    const N = 2500;
    const sp = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) sp[i] = Math.random() * 2 - 1;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snow = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ color: 0xcfefff, size: 0.12, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.applyMode();
    this.loop();
  }
  get L() {
    return this.ship ? this.ship.dims.xMax - this.ship.dims.xMin : 200;
  }
  resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  setShip(model, reframe) {
    const prevL = this.L;
    if (this.ship) {
      this.pivot.remove(this.ship.group);
      this.ship.dispose();
    }
    this.ship = model;
    this.pivot.add(model.group);
    const L = this.L;
    const d = model.dims;
    // studio props scale with the ship
    this.ground.scale.setScalar(L * 1.6);
    this.ground.position.y = d.keelY - 0.02;
    this.grid.scale.setScalar(L * 2.4);
    this.grid.position.y = d.keelY - 0.01;
    this.waterplane.scale.set(L * 1.5, L * 0.8, 1);
    const s = this.sun.shadow.camera;
    const ext = Math.max(L * 0.65, d.topY + 10);
    s.left = -ext;
    s.right = ext;
    s.top = ext;
    s.bottom = -ext;
    s.near = 1;
    s.far = L * 6;
    s.updateProjectionMatrix();
    this.caustics.shadow.camera.far = L * 4;
    this.snow.material.size = Math.max(0.06, L * 0.0006);
    this.ocean.setShip(d.xMin, d.xMax, d.halfBeam, this.ocean.speed > 0 ? Math.min(1, this.ocean.speed / 12) : 0);
    this.controls.maxDistance = L * 12;
    this.controls.minDistance = Math.max(2, L * 0.05);
    this.updateSun();
    this.rebuildCallouts();
    if (reframe || Math.abs(prevL - L) / Math.max(prevL, L) > 0.25) this.view(this.mode === 'underwater' ? 'keel' : 'quarter', !reframe);
  }
  setCallouts(v, units, visible) {
    this.calloutArgs = { v, units };
    this.showCallouts = visible;
    this.rebuildCallouts();
  }
  rebuildCallouts() {
    if (this.callouts) {
      this.pivot.remove(this.callouts);
      disposeCallouts(this.callouts);
      this.callouts = null;
    }
    if (!this.ship || !this.calloutArgs || !this.showCallouts) return;
    this.callouts = buildCallouts(this.ship.dims, this.calloutArgs.v, this.calloutArgs.units);
    this.pivot.add(this.callouts);
  }
  setMode(mode) {
    const prev = this.mode;
    this.mode = mode;
    this.applyMode();
    if (mode === 'underwater') this.view('keel');
    else if (prev === 'underwater') this.view('quarter');
  }
  setSeaState(v) {
    this.ocean.sea = v;
  }
  setSpeed(knots) {
    this.ocean.speed = knots * 0.514444;
    if (this.ship) {
      const d = this.ship.dims;
      this.ocean.setShip(d.xMin, d.xMax, d.halfBeam, Math.min(1, knots / 22));
    }
  }
  setSunElevation(deg) {
    this.sunElevation = deg;
    this.updateSun();
  }
  updateSun() {
    const phi = THREE.MathUtils.degToRad(90 - this.sunElevation);
    const theta = THREE.MathUtils.degToRad(215);
    const dir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(dir);
    const L = this.L;
    if (this.mode === 'studio') this.sun.position.set(L * 0.6, L * 1.1, L * 0.5);
    else this.sun.position.copy(dir).multiplyScalar(L * 1.5);
    const low = THREE.MathUtils.clamp(this.sunElevation / 40, 0, 1);
    this.sun.color.setRGB(1, 0.75 + 0.25 * low, 0.55 + 0.4 * low);
    this.sun.intensity = this.mode === 'studio' ? 2.2 : 0.6 + 2.2 * low;
    const skyC = new THREE.Color().setHSL(0.58, 0.55, 0.25 + 0.25 * low);
    const horizon = new THREE.Color().setHSL(0.08 + 0.48 * low, 0.45, 0.5 + 0.2 * low);
    this.ocean.setSun(dir, skyC, horizon);
    this.ocean.material.uniforms.uSunColor.value.copy(this.sun.color);
    if (this.mode !== 'studio') {
      this.skyEnv?.dispose();
      const tmp = new THREE.Scene();
      const sky2 = new Sky();
      sky2.scale.setScalar(1000);
      for (const k of Object.keys(this.sky.material.uniforms)) {
        const u = sky2.material.uniforms[k];
        const v = this.sky.material.uniforms[k].value;
        if (u && v !== undefined) u.value = v.clone ? v.clone() : v;
      }
      tmp.add(sky2);
      this.skyEnv = this.pmrem.fromScene(tmp);
      sky2.geometry.dispose();
      sky2.material.dispose();
      if (!this.underwaterLook) this.scene.environment = this.skyEnv.texture;
      const fogC = horizon.clone().lerp(new THREE.Color('#8fb3cc'), 0.5);
      this.aboveFog.color.copy(fogC);
      this.aboveFog.density = 0.9 / Math.max(800, L * 14);
    }
  }
  aboveFog = new THREE.FogExp2(0xa8c4d8, 0.0001);
  belowFog = new THREE.FogExp2(0x0b4a5a, 0.01);
  applyMode() {
    const studio = this.mode === 'studio';
    this.ground.visible = studio;
    this.grid.visible = studio;
    this.waterplane.visible = studio;
    this.ocean.mesh.visible = !studio;
    this.sky.visible = !studio;
    if (studio) {
      this.buoyancy.reset();
      this.pivot.position.set(0, 0, 0);
      this.pivot.rotation.set(0, 0, 0);
      this.scene.background = this.studioBg;
      this.scene.environment = this.studioEnv;
      this.scene.fog = null;
      this.hemi.intensity = 0.6;
      this.renderer.toneMappingExposure = 0.9;
    }
    this.underwaterLook = false;
    this.updateSun();
    this.applyUnderwater(false, true);
  }
  applyUnderwater(under, force = false) {
    if (this.mode === 'studio') under = false;
    if (under === this.underwaterLook && !force) return;
    this.underwaterLook = under;
    const L = this.L;
    this.caustics.intensity = under ? 6 : 0;
    this.caustics.castShadow = under;
    this.snow.visible = under;
    if (this.mode === 'studio') {
      this.onUnderwaterChange?.(false);
      return;
    }
    if (under) {
      this.belowFog.color.copy(this.underwaterColor);
      this.belowFog.density = 1.5 / Math.max(60, L * 1.6);
      this.scene.fog = this.belowFog;
      this.scene.background = this.underwaterColor;
      this.sky.visible = false;
      this.hemi.color.set('#4fb7c9');
      this.hemi.groundColor.set('#2a6f7c');
      this.hemi.intensity = 1.7;
      this.renderer.toneMappingExposure = 1.15;
      this.scene.environment = this.studioEnv;
    } else {
      this.scene.fog = this.aboveFog;
      this.scene.background = null;
      this.sky.visible = true;
      this.hemi.color.set('#dfeaff');
      this.hemi.groundColor.set('#2a3440');
      this.hemi.intensity = 0.45;
      this.renderer.toneMappingExposure = 0.85;
      if (this.skyEnv) this.scene.environment = this.skyEnv.texture;
    }
    this.onUnderwaterChange?.(under);
  }
  /** Smoothly fly the camera to a preset viewpoint framing the current ship. */
  view(preset, animate = true) {
    if (!this.ship) return;
    const d = this.ship.dims;
    const L = this.L;
    const midY = (d.topY + d.keelY) / 2;
    const dist = L * 1.45;
    let pos;
    let target = new THREE.Vector3((d.xMin + d.xMax) / 2, midY * 0.6, 0);
    switch (preset) {
      case 'profile':
        pos = new THREE.Vector3(target.x, midY, dist * 1.05);
        break;
      case 'bow':
        pos = new THREE.Vector3(d.xMax + L * 0.7, d.topY * 0.7 + L * 0.06, L * 0.35);
        target = new THREE.Vector3(d.xMax * 0.6, midY * 0.5, 0);
        break;
      case 'stern':
        pos = new THREE.Vector3(d.xMin - L * 0.7, d.topY * 0.7 + L * 0.06, -L * 0.35);
        target = new THREE.Vector3(d.xMin * 0.6, midY * 0.5, 0);
        break;
      case 'top':
        pos = new THREE.Vector3(target.x + 0.01, L * 1.6, 0.01);
        break;
      case 'keel': {
        const depth = d.keelY - Math.max(4, L * 0.12);
        pos = new THREE.Vector3(L * 0.45, depth, L * 0.55);
        target = new THREE.Vector3(0, d.keelY * 0.6, 0);
        break;
      }
      case 'quarter':
      default:
        pos = new THREE.Vector3(L * 0.85, Math.max(d.topY * 1.3, L * 0.38), L * 1.05);
        break;
    }
    if (this.mode !== 'studio' && preset !== 'keel' && pos.y < 4) pos.y = 4;
    if (!animate) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.tween = null;
      return;
    }
    this.tween = {
      fromPos: this.camera.position.clone(),
      toPos: pos,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      t: 0,
      dur: 1.1,
    };
  }
  setAutoRotate(on) {
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 0.6;
  }
  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
  /** the ship's rest frame (excludes wave motion) for export */
  get shipGroup() {
    return this.ship?.group ?? null;
  }
  loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, this.clock.getDelta());
    this.elapsed += dt;
    const t = this.elapsed;
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
      if (tw.t >= 1) this.tween = null;
    }
    this.controls.update();
    if (this.mode !== 'studio' && this.ship) {
      this.ocean.update(t, dt);
      if (this.motion) {
        const d = this.ship.dims;
        this.buoyancy.step(this.ocean, t, dt, this.L, d.halfBeam * 2);
        this.pivot.position.y = this.buoyancy.heave;
        this.pivot.rotation.set(this.buoyancy.roll, 0, this.buoyancy.pitch);
      }
      const cam = this.camera.position;
      const under = cam.y < this.ocean.heightAt(cam.x, cam.z, t) - 0.2;
      this.applyUnderwater(under);
      if (under) {
        const L = this.L;
        this.caustics.position.set(cam.x * 0.3, L * 0.6, cam.z * 0.3);
        this.caustics.target.position.set(0, this.ship.dims.keelY, 0);
        this.caustics.distance = L * 3;
        this.causticTex.offset.set((t * 0.03) % 1, (t * 0.017) % 1);
        this.causticTex.rotation = Math.sin(t * 0.1) * 0.2;
        const span = Math.max(20, L * 0.25);
        this.snow.scale.setScalar(span);
        this.snow.position.copy(cam);
        this.snow.position.y -= 0;
        this.snow.rotation.y = t * 0.01;
        this.snow.position.y += Math.sin(t * 0.2) * 0.5;
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  };
  /** Stop drawing (the screen is hidden). */
  pause() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
  /** Draw again; the clock skips the time spent hidden. */
  resume() {
    if (this.raf) return;
    this.clock.getDelta();
    this.loop();
  }
  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    if (this.callouts) disposeCallouts(this.callouts);
    this.ship?.dispose();
    this.ocean.dispose();
    this.skyEnv?.dispose();
    this.studioEnv.dispose();
    this.pmrem.dispose();
    this.causticTex.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}
