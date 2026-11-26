// The ship builder's AI, on this device, off the page's thread: transformers.js with ONNX Runtime
// (WebGPU when the browser has it, else WebAssembly). Two models, each downloaded once from Hugging
// Face and kept in the browser's cache:
//   - cutting the vessel out of a photo: ormbg (Apache 2.0; an ISNet trained to remove backgrounds),
//     88 MB on the GPU, 44 MB on the processor;
//   - describing a photo: Qwen3.5 (Apache 2.0), a vision-language model: 0.8B (about 850 MB), 2B
//     (2.2 GB) or 4B (3.8 GB), as chosen (ai.js's VISION_MODELS); one at a time is kept loaded.
// After a failure on the GPU the cut-out runs on the processor, in a fresh worker (ai.js, ?cpu).
// Messages in: { id, task: 'cutout', blob } and { id, task: 'describe', blob, prompt, maxTokens, model }.
// Out: { id, progress: { model, file, loaded, total } } while downloading, { id, token } while
// writing, then { id, result } or { id, error }.

const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';
export const CUTOUT_MODEL = 'onnx-community/ormbg-ONNX';
export const DESCRIBE_MODEL = 'onnx-community/Qwen3.5-0.8B-ONNX-OPT';

let tf = null;
const lib = () => (tf ??= import(TRANSFORMERS).then((m) => {
  m.env.allowLocalModels = false;
  return m;
}));

// What this device's GPU can do: WebGPU at all, and 16-bit floats in shaders (halves the downloads).
let gpu = null;
async function device() {
  gpu ??= (async () => {
    try {
      const a = await navigator.gpu?.requestAdapter();
      return a ? { webgpu: true, f16: a.features.has('shader-f16'), buffers: a.limits.maxStorageBuffersPerShaderStage } : { webgpu: false, f16: false };
    } catch {
      return { webgpu: false, f16: false };
    }
  })();
  return gpu;
}

const progressFor = (id, model) => (p) => {
  if (p.status === 'progress' && p.total) {
    self.postMessage({ id, progress: { model, file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0, status: p.status } });
  }
};

let cutter = null;
const cpuOnly = new URL(self.location.href).searchParams.has('cpu');
async function cutout(id, blob) {
  const { pipeline, RawImage } = await lib();
  const d = await device();
  const cutOnGpu = d.webgpu && !cpuOnly;
  const make = () => pipeline('background-removal', CUTOUT_MODEL, {
    device: cutOnGpu ? 'webgpu' : 'wasm',
    dtype: cutOnGpu ? (d.f16 ? 'fp16' : 'fp32') : 'quantized',
    progress_callback: progressFor(id, 'cutout'),
  }).catch((e) => { cutter = null; throw e; });
  cutter ??= make();
  const img = await RawImage.fromBlob(blob);
  let out;
  try {
    out = await (await cutter)(img);
  } catch (e) {
    throw new Error(cutOnGpu ? `GPU: ${e.message}` : e.message);
  }
  // the vessel's mask: the alpha of the cut-out
  const rgba = out.channels === 4 ? out : out.rgba();
  const alpha = new Uint8Array(rgba.width * rgba.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba.data[i * 4 + 3];
  return { width: rgba.width, height: rgba.height, alpha };
}

let describer = null;
let describerRepo = '';
async function loadDescriber(id, repo = DESCRIBE_MODEL) {
  const { AutoProcessor, Qwen3_5ForConditionalGeneration } = await lib();
  const d = await device();
  if (describer && describerRepo !== repo) {
    // another model chosen: the one loaded gives its memory back first (the larger need all of it)
    const old = describer;
    describer = null;
    try { (await old).model.dispose?.(); } catch { /* it never loaded */ }
  }
  describerRepo = repo;
  describer ??= (async () => {
    const progress_callback = progressFor(id, 'describe');
    const processor = await AutoProcessor.from_pretrained(repo, { progress_callback });
    const model = await Qwen3_5ForConditionalGeneration.from_pretrained(repo, {
      dtype: {
        embed_tokens: 'q4',
        vision_encoder: d.webgpu && d.f16 ? 'fp16' : 'q4',
        decoder_model_merged: 'q4',
      },
      device: d.webgpu ? 'webgpu' : 'wasm',
      progress_callback,
    });
    return { processor, model };
  })().catch((e) => { describer = null; throw e; });
  return describer;
}

async function describe(id, blob, prompt, maxTokens = 220, repo = DESCRIBE_MODEL) {
  if (!repo.startsWith('onnx-community/Qwen3.5-')) throw new Error(`Not a vision model this page runs: ${repo}`);
  const { RawImage, TextStreamer } = await lib();
  const { processor, model } = await loadDescriber(id, repo);
  let image = await RawImage.fromBlob(blob);
  // about 640 px across: enough to read a name on the hull, few enough image tokens to be quick
  const k = Math.min(1, 640 / Math.max(image.width, image.height));
  if (k < 1) image = await image.resize(Math.round(image.width * k), Math.round(image.height * k));
  const conversation = [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: prompt }] }];
  const text = processor.apply_chat_template(conversation, { add_generation_prompt: true, enable_thinking: false });
  const inputs = await processor(text, image);
  const streamer = new TextStreamer(processor.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (t) => self.postMessage({ id, token: t }),
  });
  const outputs = await model.generate({ ...inputs, max_new_tokens: maxTokens, do_sample: false, streamer });
  const decoded = processor.batch_decode(outputs.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: true });
  return { text: decoded[0] ?? '', device: (await device()).webgpu ? 'webgpu' : 'wasm' };
}

self.onmessage = async (e) => {
  const { id, task } = e.data ?? {};
  try {
    let result;
    if (task === 'cutout') result = await cutout(id, e.data.blob);
    else if (task === 'describe') result = await describe(id, e.data.blob, e.data.prompt, e.data.maxTokens, e.data.model);
    else if (task === 'device') result = await device();
    else throw new Error(`Unknown task ${task}`);
    self.postMessage({ id, result }, result?.alpha ? [result.alpha.buffer] : []);
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
