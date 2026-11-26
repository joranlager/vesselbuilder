// Ship inspector: the animated ocean surface and the buoyancy that makes the ship ride it.

import * as THREE from '../vendor/three.js';

const G = 9.81;
const WAVE_COUNT = 7;
function makeWaves() {
  const base = [
    { ang: 0.35, len: 180, a: 2.2 },
    { ang: -0.2, len: 110, a: 1.4 },
    { ang: 0.9, len: 75, a: 0.9 },
    { ang: -0.75, len: 52, a: 0.6 },
    { ang: 0.15, len: 36, a: 0.38 },
    { ang: 1.4, len: 27, a: 0.25 },
    { ang: -1.2, len: 19, a: 0.16 },
  ];
  return base.map((w, i) => ({
    dir: [Math.cos(w.ang + 2.6), Math.sin(w.ang + 2.6)],
    k: (2 * Math.PI) / w.len,
    a: w.a,
    phase: i * 1.7,
  }));
}
const vertex = /* glsl */ `
uniform float uTime;
uniform float uSea;
uniform float uFlow;
uniform vec4 uW[${WAVE_COUNT}];
uniform float uPh[${WAVE_COUNT}];
varying vec3 vWorld;
varying float vH;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p = wp.xz + vec2(uFlow, 0.0);
  float h = 0.0;
  for (int i = 0; i < ${WAVE_COUNT}; i++) {
    vec4 w = uW[i];
    float om = sqrt(9.81 * w.z);
    h += w.w * uSea * sin(w.z * dot(w.xy, p) - om * uTime + uPh[i]);
  }
  wp.y += h;
  vH = h;
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const fragment = /* glsl */ `
uniform float uTime;
uniform float uSea;
uniform float uFlow;
uniform vec4 uW[${WAVE_COUNT}];
uniform float uPh[${WAVE_COUNT}];
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec4 uShip; // xStern, xBow, halfBeam, speed (0..1)
varying vec3 vWorld;
varying float vH;
#include <fog_pars_fragment>

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

void main() {
  vec2 p = vWorld.xz + vec2(uFlow, 0.0);
  // analytic slope of the big waves
  vec2 grad = vec2(0.0);
  for (int i = 0; i < ${WAVE_COUNT}; i++) {
    vec4 w = uW[i];
    float om = sqrt(9.81 * w.z);
    float c = cos(w.z * dot(w.xy, p) - om * uTime + uPh[i]);
    grad += w.w * uSea * w.z * c * w.xy;
  }
  // ripples (normal only)
  float t = uTime;
  vec2 r1 = vec2(sin(p.x * 0.9 + t * 1.7 + sin(p.y * 0.35)), cos(p.y * 1.1 - t * 1.3 + sin(p.x * 0.27)));
  vec2 r2 = vec2(sin(dot(p, vec2(0.37, 1.9)) + t * 2.3), cos(dot(p, vec2(1.7, -0.6)) - t * 2.1));
  grad += (r1 * 0.035 + r2 * 0.025) * (0.35 + uSea);
  vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));

  vec3 V = normalize(cameraPosition - vWorld);
  bool under = cameraPosition.y < vWorld.y;
  vec3 col;
  float alpha = 1.0;
  if (under) {
    // looking up at the surface from below: Snell's window with the sun inside it
    float cosT = abs(dot(V, n));
    float snell = smoothstep(0.62, 0.75, cosT);
    col = mix(uDeep * 1.6, uSky * 1.3 + vec3(0.1, 0.18, 0.2), snell);
    float sunU = pow(max(dot(-V, normalize(uSunDir)), 0.0), 80.0);
    col += uSunColor * sunU * 1.5;
    alpha = 0.97;
  } else {
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(V, n), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  vec3 skyCol = mix(uHorizon, uSky, clamp(R.y * 1.6, 0.0, 1.0));
  vec3 H = normalize(V + normalize(uSunDir));
  float spec = pow(max(dot(n, H), 0.0), 260.0) * 2.5;
  float sss = pow(max(vH / (2.5 * uSea + 0.01), 0.0), 2.0) * 0.35;
  vec3 water = mix(uDeep, uShallow, sss + 0.12);
  col = mix(water, skyCol, fres) + uSunColor * spec;

  // whitecaps on steep crests
  float crest = smoothstep(0.55, 1.0, vH / (2.6 * uSea + 0.001)) * smoothstep(0.35, 0.8, uSea);
  float foam = crest * smoothstep(0.4, 0.75, fbm(p * 0.12 + t * 0.05));

  // ship wake: churned centreline + Kelvin wedge arms, plus bow wave hugging the hull
  float spd = uShip.w;
  if (spd > 0.01) {
    float xs = uShip.x; float xb = uShip.y; float hb = uShip.z;
    float len = xb - xs;
    float az = abs(vWorld.z);
    float behind = xs - vWorld.x;
    vec2 q = vec2(vWorld.x + uFlow, vWorld.z);
    float streaks = fbm(vec2(q.x * 0.05, q.y * 0.35));
    if (behind > -hb) {
      float bh = max(behind, 0.0);
      float fade = exp(-bh / (len * (0.6 + 2.5 * spd)));
      float width = hb * (0.9 + bh * 0.03);
      float centre = (1.0 - smoothstep(width * 0.4, width, az)) * fade * smoothstep(-hb, 0.0, behind);
      float arm = bh * 0.354 + hb;
      float wedge = (1.0 - smoothstep(0.0, hb * 0.8, abs(az - arm))) * fade * 0.6 * smoothstep(0.0, hb * 2.0, bh);
      foam = max(foam, smoothstep(0.38, 0.72, streaks) * (centre + wedge) * (0.25 + 0.6 * spd));
    }
    float along = vWorld.x - xs;
    if (along > 0.0 && along < len * 1.04) {
      // rough plan outline of the hull: fine at both ends
      float hw = hb * clamp(min(along / (0.12 * len), (len - along) / (0.28 * len)), 0.0, 1.0);
      float d = az - hw;
      float band = exp(-max(d, 0.0) / (hb * 0.35)) * step(-0.5, d);
      float bowness = 0.25 + 0.75 * smoothstep(len * 0.55, len, along);
      foam = max(foam, band * bowness * spd * 1.4 * smoothstep(0.25, 0.65, fbm(q * 0.25 + t * 0.3)));
    }
  }
  col = mix(col, vec3(0.92, 0.95, 0.97), clamp(foam, 0.0, 1.0));
  }
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
export class Ocean {
  mesh;
  material;
  waves = makeWaves();
  sea = 0.4; // 0..1 sea state
  flow = 0; // accumulated distance the water has moved past the ship
  speed = 0; // m/s
  constructor() {
    // radially graded grid: dense near the ship, sparse towards the horizon
    const segs = 360;
    const R = 9000;
    const g = new THREE.PlaneGeometry(2, 2, segs, segs);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i);
      const v = pos.getY(i);
      const f = (q) => Math.sign(q) * R * Math.pow(Math.abs(q), 2.1);
      pos.setXY(i, f(u), f(v));
    }
    g.rotateX(-Math.PI / 2);
    g.computeBoundingSphere();
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      side: THREE.DoubleSide,
      transparent: true,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uSea: { value: this.sea },
          uFlow: { value: 0 },
          uW: { value: this.waves.map((w) => new THREE.Vector4(w.dir[0], w.dir[1], w.k, w.a)) },
          uPh: { value: this.waves.map((w) => w.phase) },
          uSunDir: { value: new THREE.Vector3(0.4, 0.5, 0.3).normalize() },
          uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
          uSky: { value: new THREE.Color('#4d7fb8') },
          uHorizon: { value: new THREE.Color('#bcd2e3') },
          uDeep: { value: new THREE.Color('#062a3f') },
          uShallow: { value: new THREE.Color('#1c6b7a') },
          uShip: { value: new THREE.Vector4(-50, 50, 10, 0) },
        },
      ]),
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'ocean';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }
  heightAt(x, z, t) {
    let h = 0;
    const px = x + this.flow;
    for (const w of this.waves) {
      const om = Math.sqrt(G * w.k);
      h += w.a * this.sea * Math.sin(w.k * (w.dir[0] * px + w.dir[1] * z) - om * t + w.phase);
    }
    return h;
  }
  /** The grid is densest at the origin, where the ship sits; the water flows past instead of the ship moving. */
  update(t, dt) {
    this.flow += this.speed * dt;
    const u = this.material.uniforms;
    u.uTime.value = t;
    u.uSea.value = this.sea;
    u.uFlow.value = this.flow;
  }
  setShip(xStern, xBow, halfBeam, speed01) {
    this.material.uniforms.uShip.value.set(xStern, xBow, halfBeam, speed01);
  }
  setSun(dir, sky, horizon) {
    this.material.uniforms.uSunDir.value.copy(dir);
    this.material.uniforms.uSky.value.copy(sky);
    this.material.uniforms.uHorizon.value.copy(horizon);
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
/** Water-plane buoyancy: samples a grid under the hull and derives heave, pitch and roll. */
export class Buoyancy {
  heave = 0;
  pitch = 0;
  roll = 0;
  vHeave = 0;
  vPitch = 0;
  vRoll = 0;
  step(ocean, t, dt, L, B) {
    const nx = 7;
    const nz = 3;
    let sum = 0;
    let sumX = 0;
    let sumZ = 0;
    let wx = 0;
    let wz = 0;
    for (let i = 0; i < nx; i++) {
      const x = (i / (nx - 1) - 0.5) * L * 0.9;
      for (let j = 0; j < nz; j++) {
        const z = (j / (nz - 1) - 0.5) * B * 0.9;
        const h = ocean.heightAt(x, z, t);
        sum += h;
        sumX += h * x;
        sumZ += h * z;
        wx += x * x;
        wz += z * z;
      }
    }
    const n = nx * nz;
    const targetHeave = sum / n;
    const targetPitch = Math.atan(sumX / Math.max(1e-6, wx)); // slope along x
    const targetRoll = -Math.atan(sumZ / Math.max(1e-6, wz)) * 0.9; // slope across
    // damped springs: bigger ships respond more slowly
    const k = 4.0 / Math.max(1, Math.sqrt(L / 30));
    const c = 2.2 * Math.sqrt(k);
    dt = Math.min(dt, 0.05);
    this.vHeave += (k * (targetHeave - this.heave) - c * this.vHeave) * dt;
    this.vPitch += (k * (targetPitch - this.pitch) - c * this.vPitch) * dt;
    this.vRoll += (k * 0.7 * (targetRoll - this.roll) - c * 0.5 * this.vRoll) * dt;
    this.heave += this.vHeave * dt;
    this.pitch += this.vPitch * dt;
    this.roll += this.vRoll * dt;
  }
  reset() {
    this.heave = this.pitch = this.roll = 0;
    this.vHeave = this.vPitch = this.vRoll = 0;
  }
}
