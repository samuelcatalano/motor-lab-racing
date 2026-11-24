# WebGPU-only renderer design

## Intent

Make Motor Lab Racing render through WebGPU so the published game exercises the graphics API the user expects. The current Pages build matches the local build, but the application itself creates a `WebGLRenderer`; fixing deployment alone cannot enable WebGPU.

## Goals

- Initialize Three.js `WebGPURenderer` and ensure the game runs only when its active backend is WebGPU.
- Port the scene's custom shader effects to Three.js node materials and TSL.
- Preserve the current circuit, kart, driving, cameras, weather/time settings, touch controls, lap timing, and local records where supported by WebGPU.
- Show a clear startup message when the browser/device has no WebGPU adapter or WebGPU initialization fails. Do not fall back to WebGL.
- Publish the resulting build through the existing GitHub Pages workflow.

## Non-goals

- Keep WebGL support or add a WebGL fallback.
- Change driving physics, track content, game flow, or the authored art direction.
- Upgrade Three.js unless the pinned version lacks a required WebGPU API; if an upgrade is needed, document the specific blocker before taking it.

## Current constraints

- The app pins Three.js `0.187.0` and currently imports from `three`.
- Renderer creation and resize/render calls live in `src/world.js`; `src/main.js` starts the frame loop after `createWorld()` resolves.
- Custom GLSL exists in the road material, skid marks, tire smoke, rain, sky, and floodlight glow. Kart materials are also modified through `onBeforeCompile` for wet beading. These require migration because Three.js documents `ShaderMaterial`, `RawShaderMaterial`, and `onBeforeCompile` as unsupported in `WebGPURenderer`.
- Three.js initializes `WebGPURenderer` asynchronously and automatically falls back to WebGL 2 when WebGPU is unavailable. The app must reject missing adapters before startup and verify the initialized backend is WebGPU to honor the no-fallback decision.
- GitHub Pages serves the app over HTTPS, which provides a secure context for WebGPU.

## Approaches considered

1. **Keep the current WebGL renderer.** Lowest effort, but it does not satisfy the reason for this change.
2. **Use `WebGPURenderer` with automatic WebGL fallback.** Preserves broader device support, but does not guarantee that a tester is exercising WebGPU.
3. **WebGPU only (selected).** Require an available WebGPU adapter, initialize `WebGPURenderer`, verify its backend, and report a clear startup error if WebGPU cannot be used. This matches the user's selection and makes the test result unambiguous; unsupported devices cannot play this build.

## Design

- Switch renderer imports to Three.js's `three/webgpu` entry and await `renderer.init()` before returning the world to `main.js`.
- Check for WebGPU availability and an adapter before allocating the scene. After initialization, verify the renderer selected its WebGPU backend; dispose resources and surface an explicit error otherwise.
- Replace custom GLSL and built-in-material patches with TSL-based node materials. Keep attributes/uniforms dynamic where the current game updates weather, wetness, lamp reflections, particles, and tire marks each frame.
- Replace shader features that cannot be represented by current WebGPU node-material APIs with the smallest geometry/node-material equivalent that preserves their visible behavior. Any material visual changes discovered during implementation should be surfaced rather than silently dropped.
- Update startup messaging so it states that WebGPU is required. The game loop remains gated on successful world creation.

## Validation

- Build the static site and confirm the published bundle loads from the GitHub Pages project path.
- Use the current Chrome stable on macOS as the initial browser baseline, provided it exposes a WebGPU adapter; devices without WebGPU are expected to show the requirement message.
- In that WebGPU-capable browser, verify the active backend is WebGPU and exercise the main views and conditions, rain/wet effects, and tire effects.
- In a browser/device without WebGPU, verify startup stops with the clear requirement message and never starts WebGL.
- Confirm a newly pushed `main` build completes the existing Pages deployment workflow.

## Visual acceptance

Keep the current art direction and preserve each custom effect as closely as practical. Small backend-specific image differences are acceptable, but no effect may be silently removed; report any material visual differences for review.

## Documentation references

- Three.js WebGPURenderer initialization and migration notes: https://threejs.org/manual/pages/webgpurenderer
- Three.js Material `onBeforeCompile` is WebGLRenderer-only: https://threejs.org/docs/pages/Material.html
