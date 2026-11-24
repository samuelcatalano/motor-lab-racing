import assert from 'node:assert/strict';
import test from 'node:test';
import {createWebGpuRenderer, WebGPUUnavailableError} from '../src/webgpu-renderer.js';

const canvas = {};
const validGpu = {requestAdapter: async () => ({})};

test('rejects before creating a renderer when WebGPU is missing', async () => {
  let created = false;

  await assert.rejects(
    createWebGpuRenderer(canvas, {
      gpu: undefined,
      rendererFactory: () => { created = true; },
    }),
    WebGPUUnavailableError,
  );
  assert.equal(created, false);
});

test('rejects before creating a renderer when no WebGPU adapter is available', async () => {
  let created = false;

  await assert.rejects(
    createWebGpuRenderer(canvas, {
      gpu: {requestAdapter: async () => null},
      rendererFactory: () => { created = true; },
    }),
    WebGPUUnavailableError,
  );
  assert.equal(created, false);
});

test('disposes and rejects if Three.js initializes a non-WebGPU backend', async () => {
  let disposed = false;
  const renderer = {
    backend: {isWebGPUBackend: false},
    init: async () => {},
    dispose: () => { disposed = true; },
  };

  await assert.rejects(
    createWebGpuRenderer(canvas, {
      gpu: validGpu,
      rendererFactory: () => renderer,
    }),
    WebGPUUnavailableError,
  );
  assert.equal(disposed, true);
});

test('returns the renderer after a WebGPU backend initializes', async () => {
  const renderer = {
    backend: {isWebGPUBackend: true},
    init: async () => {},
    dispose: () => {},
  };

  const result = await createWebGpuRenderer(canvas, {
    gpu: validGpu,
    rendererFactory: () => renderer,
  });

  assert.equal(result, renderer);
});
