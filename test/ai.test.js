import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VISION_MODELS, visionModel, setVisionModel, MODEL_SIZES, VISION_KEY } from '../public/ships/ai.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
};

test('the vision model is chosen per device, the smallest until then', () => {
  const s = memory();
  assert.equal(visionModel(s).id, '0.8b');
  setVisionModel('4b', s);
  assert.equal(visionModel(s).repo, 'onnx-community/Qwen3.5-4B-ONNX-OPT');
  assert.throws(() => setVisionModel('70b', s));
  s.setItem(VISION_KEY, '{"model":"gone"}');
  assert.equal(visionModel(s).id, '0.8b', 'a model no longer offered: the default');
  s.setItem(VISION_KEY, 'not json');
  assert.equal(visionModel(s).id, '0.8b');
});

test('every vision model is a Qwen3.5 the worker runs, smallest first', () => {
  for (const m of VISION_MODELS) assert.match(m.repo, /^onnx-community\/Qwen3\.5-[\d.]+B-ONNX-OPT$/);
  const sizes = VISION_MODELS.map((m) => m.size);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b));
  assert.equal(MODEL_SIZES.describe, VISION_MODELS[0].size, 'with no storage: the default');
});
