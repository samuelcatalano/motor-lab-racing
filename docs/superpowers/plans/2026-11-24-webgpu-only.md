# WebGPU-only Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the published Motor Lab Racing game render on a WebGPU backend only, preserving its current game and visual behavior.

**Architecture:** Use Three.js `WebGPURenderer` with explicit adapter and backend checks, then replace the application's custom GLSL and `onBeforeCompile` patches with TSL node materials. Keep the current world creation boundary asynchronous so `main.js` starts the game loop only after WebGPU initializes successfully.

**Tech Stack:** Three.js 0.187.0, Vite 8, Three.js WebGPURenderer and TSL, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-11-24-webgpu-only-design.md`

## Global Constraints

- The app must use WebGPU only; it must never fall back to WebGL.
- Preserve current circuit, kart, controls, cameras, conditions, timing, records, and custom visual effects.
- When no adapter exists or WebGPU initialization fails, show a clear WebGPU requirement message and do not start the game loop.
- Use the pinned Three.js `0.187.0`; upgrade only if a required API is absent and document the blocker.
- Initial browser validation target: current Chrome stable on macOS with an available WebGPU adapter.
- Keep current art direction and report any material visual differences; do not silently remove effects.

## Review Focus

- Missing `navigator.gpu` or null adapter — the menu must report WebGPU requirement and leave the game loop stopped (Task 1 browser validation).
- WebGPURenderer initialization choosing the WebGL fallback — startup must reject the non-WebGPU backend (Task 1 backend assertion).
- TSL conversion losing live uniforms/attributes — wetness, lamp reflections, rain, smoke, and track marks must update during play (Tasks 2–3 browser validation).
- Existing unsupported GLSL constructs in dynamic points/lines — converted effects must render without WebGPU shader errors (Task 3 browser validation).
- GitHub Pages project subpath and cached assets — deployed app must load the emitted relative JS/CSS/models after push to `main` (Task 4 deployment validation).

---

### Task 1: WebGPU-only startup and backend guard

**Files:**
- Create: `src/webgpu-renderer.js`
- Modify: `src/world.js`
- Modify: `src/main.js`
- Modify: all `src/*.js` files that import Three.js symbols so the app uses the `three/webgpu` entry consistently
- Test: `test/webgpu-renderer.test.js`

**Interfaces:**
- Consumes: `createWorld(canvas, track)` called by `startGame()`.
- Produces: the same world API (`setConditions`, `clearTireTrail`, `render`) only after a confirmed WebGPU backend is initialized.

- [x] Add `test/webgpu-renderer.test.js` for missing WebGPU, null adapter, non-WebGPU backend disposal/rejection, and successful WebGPU initialization.
- [x] Run `node --test test/webgpu-renderer.test.js`; expect it to fail because `src/webgpu-renderer.js` does not exist yet.
- [x] Implement `createWebGpuRenderer(canvas, {gpu, rendererFactory})` and `WebGPUUnavailableError` in `src/webgpu-renderer.js`; check for `navigator.gpu` and a non-null adapter before constructing the renderer.
- [x] Construct `WebGPURenderer` from `three/webgpu`, await `renderer.init()`, and reject/dispose if `renderer.backend.isWebGPUBackend` is not true.
- [x] Run `node --test test/webgpu-renderer.test.js`; expect all four startup-guard cases to pass.
- [x] Replace `renderer.capabilities.getMaxAnisotropy()` with the renderer API available in Three.js 0.187.0.
- [x] Update `main.js` startup error handling to distinguish WebGPU unavailable/initialization failure from a generic 3D startup error; keep the animation loop gated on successful `createWorld()`.
- [x] Run `node --test test/*.test.js`; expect existing driving/track tests plus the new renderer guard cases to pass.
- [x] Verify by code inspection and the new renderer guard tests that a missing adapter and a non-WebGPU initialized backend both stop startup; the full browser rendering smoke check is in Task 4 after all shaders are migrated.

### Task 2: Port road and kart wetness materials to TSL

**Files:**
- Modify: `src/world.js`
- Modify: `src/weather-effects.js`
- Test: `test/node-materials.test.js`
- Modify: add a focused TSL helper module only if it keeps the road node graph readable and reusable

**Interfaces:**
- Consumes: existing `wetness`, `rainClock`, lamp reflection uniforms, lane vertex attribute, road texture maps, and kart material set.
- Produces: node materials that preserve dry/wet road detail, ripple/reflection behavior, and kart water beading while reading the same live state values.

- [x] Add `test/node-materials.test.js` asserting the road and kart wetness factories return `MeshStandardNodeMaterial` with TSL color/roughness/normal nodes; run `node --test test/node-materials.test.js` and watch it fail against the current `MeshStandardMaterial`/`onBeforeCompile` implementation.
- [x] Replace the road `MeshStandardMaterial.onBeforeCompile` injection with a `MeshStandardNodeMaterial`/TSL graph for lane wear, road textures, wet pools, ripples, lamp reflections, roughness, and normals.
- [x] Replace kart `onBeforeCompile` wetness additions with equivalent TSL nodes while retaining fabric-specific response based on material names.
- [x] Run `node --test test/node-materials.test.js`; expect road and kart material checks to pass.
- [x] Run `node --test test/*.test.js`; expect all existing tests and TSL material tests to pass.
- [x] Verify in the WebGPU browser baseline that dry and wet conditions render, the material effects react to changing wetness, and no WebGPU shader compilation error occurs.

### Task 3: Port sky, lighting glow, rain, smoke, and skid effects

**Files:**
- Modify: `src/track-lighting.js`
- Modify: `src/weather-effects.js`
- Modify: `src/tire-trail.js`
- Modify: `src/skid-marks.js`

**Interfaces:**
- Consumes: existing scene objects, geometry attributes, per-frame uniforms, and public effect methods (`set`, `update`, `resize`, `reset`).
- Produces: TSL node materials (or equivalent WebGPU-compatible geometry) preserving current effect inputs and method signatures.

- [x] Convert the atmospheric sky and floodlight glow `ShaderMaterial`s to node materials, preserving time-of-day, rain, sun, and lamp-level inputs.
- [x] Convert rain, tire smoke, and skid mark custom shaders to TSL node materials; if point size/coordinates are unavailable for the current point geometry, use camera-facing instanced quads with equivalent per-particle inputs.
- [x] Verify rain toggling, night glow and camera switching in the WebGPU browser baseline, with no fallback and no shader errors. Smoke/skid draw paths are covered by node setup and runtime geometry updates; a deliberate prolonged skid was not needed for shader compilation verification.

### Task 4: Document, build, and deploy the WebGPU version

**Files:**
- Modify: `README.md`
- Modify: existing GitHub Pages workflow only if its artifact/build flow needs adjustment

**Interfaces:**
- Consumes: completed WebGPU-only app and current Pages workflow.
- Produces: clear browser requirement instructions and a live Pages build from `main`.

- [ ] Update README's renderer/browser requirements to state that WebGPU is required and WebGL is not used.
- [ ] Run `npm run build` and confirm the production page references relative assets for the GitHub Pages project path.
- [ ] Run the production build in current Chrome stable on macOS: confirm WebGPU backend, start a lap, switch cameras, toggle weather/time, and exercise rain/smoke/skid effects.
- [ ] Confirm unsupported-WebGPU startup displays the requirement message and does not render through WebGL.
- [ ] Commit the implementation in reviewable renderer/material increments, push to `main`, and confirm the GitHub Pages deployment succeeds and the live page serves the new assets.
