import {WebGPURenderer} from 'three/webgpu';

export class WebGPUUnavailableError extends Error {
  constructor(cause) {
    super('Este jogo exige suporte a WebGPU neste navegador e dispositivo.', {cause});
    this.name = 'WebGPUUnavailableError';
  }
}

export async function createWebGpuRenderer(canvas, {
  gpu = globalThis.navigator?.gpu,
  rendererFactory = (target, options) => new WebGPURenderer({canvas: target, ...options}),
} = {}) {
  if (!gpu || typeof gpu.requestAdapter !== 'function') {
    throw new WebGPUUnavailableError();
  }

  let adapter;
  try {
    adapter = await gpu.requestAdapter();
  } catch (error) {
    throw new WebGPUUnavailableError(error);
  }
  if (!adapter) throw new WebGPUUnavailableError();

  let renderer;
  try {
    renderer = rendererFactory(canvas, {antialias: true});
    await renderer.init();
    if (renderer.backend?.isWebGPUBackend !== true) {
      throw new Error('Three.js initialized a non-WebGPU backend.');
    }
    return renderer;
  } catch (error) {
    renderer?.dispose?.();
    throw new WebGPUUnavailableError(error);
  }
}
