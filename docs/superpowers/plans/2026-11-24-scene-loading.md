# MOTOR LAB RACING Scene and Loading Improvements Implementation Plan

> **For agentic workers:** Use the approved Sol-agent workflow for implementation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Implementation complete. Browser acceptance covered Vale do Cedro startup and clear/rain/day/dusk/night changes. This repository currently defines only Vale do Cedro; a moving night lap, rapid overlapping selection, forced compile failure, and screen-reader behavior were not exercised.

**Goal:** Improve the roadside scene, make every night floodlight consistently white, and give truthful loading feedback during startup and condition changes.

**Architecture:** Preserve the existing WebGPU scene and asset paths. Add low-cost batched details to the track edge, use one neutral-white palette for floodlight components, and expose asset, renderer, scene, and pipeline progress through a callback from `createWorld` to an accessible menu status. Prepare only the selected weather/period pipelines and rely on Three.js renderer caching for later selections.

**Tech Stack:** Three.js 0.187.0 WebGPU renderer, Vite, existing instancing and geometry merge helpers, DOM/CSS status UI.

**Spec:** `docs/superpowers/specs/2026-11-24-scene-loading-design.md`

## Global Constraints

- Preserve first-person view, WebGPU-only rendering, existing assets and local GLB routes, controls, lap timing, sound, and driving physics.
- Add no package dependencies, external downloads, or new large art assets.
- Keep roadside details clear of the racing line and use existing seeded variation and batching patterns.
- All floodlight slots, bulb emitters, and glow use neutral white; night sky and ambient fill may remain dark blue.
- Report measured asset and pipeline progress or named stages; never show an invented combined percentage.
- Do not precompile all six weather/period combinations at startup.
- Do not add automated tests; the approved spec calls for a production build and focused browser inspection.

## Review Focus

- Different track seeds and widths keep added props outside the driving line — inspect generated trackside detail in the existing WebGPU view.
- Reused floodlight slots cannot change lamp hue as the kart moves — inspect a night lap from the current view.
- Local GLB fetch/parse and texture/HDR loads report truthful progress even though they use different loading paths — compare reported counts with completed loader items.
- A failed WebGPU initialization leaves the existing recoverable startup message visible and play disabled — inspect the failure path from the menu.
- Repeated or rapid weather/period choices cannot overlap pipeline compilation or leave stale selections — switch conditions repeatedly and inspect the final displayed choice and full frame.

---

### Task 1: Add restrained track-edge variation

**Files:**
- Modify: `src/trackside-view.js` — `addTracksideDetails(scene, track)` owns generated roadside markers and batched meshes.
- Modify only if needed: `src/world.js` — it already calls `addTracksideDetails(scene, track)` while constructing the track.

**Interfaces:**
- Consumes: existing `track.at(u, offset)`, `track.width`, `track.seed`, `random(seed)`, `mergeGeometries`, and current `addTracksideDetails(scene, track)` call.
- Produces: additional seeded, static, low-profile track-edge meshes using existing materials and batched geometry; no new exported API.

- [x] **Step 1: Add seeded gravel and low vegetation variation** in `addTracksideDetails(scene, track)`, positioning each instance relative to track edges and existing runoff, with deterministic randomness from the existing track seed.
- [x] **Step 2: Batch the new static geometry** with `InstancedMesh` or `mergeGeometries`, following the file's existing merged-post path; reuse current colors/materials and avoid per-frame updates or new textures.
- [x] **Step 3: Inspect the current WebGPU view** on each configured track. Vale do Cedro is the only track configured; confirm its shoulder reads less uniform, props remain out of the racing line, and no new obvious shadow/performance burden appears.

### Task 2: Make night floodlights consistently white

**Files:**
- Modify: `src/track-lighting.js` — `floodlights(scene, track)` creates and reassigns active lamp slots, bulbs, and glow sprites.

**Interfaces:**
- Consumes: existing floodlight slot reuse, bulb material, glow canvas/material, and `set(power, wet)` / `update(kart)` behavior.
- Produces: unchanged exported API and light count, with all lamp components using the same neutral-white color regardless of slot index.

- [x] **Step 1: Remove slot-index color variation** by assigning the same neutral-white color and intensity to every `T.SpotLight` created in `floodlights`.
- [x] **Step 2: Neutralize emitter and glow tint** so the bulb emissive material, glow gradient, and glow material do not introduce yellow or blue lamp color; preserve the dark/cool night ambience outside the lamps.
- [x] **Step 3: Inspect clear and wet night scenes** from the existing view and confirm the visible sources stay white. Static review confirms slot reassignment uses the same settings; a moving night lap was not manually exercised.

### Task 3: Report startup stages and prepare condition pipelines

**Files:**
- Modify: `src/world.js` — `createWorld(canvas, track, options)` coordinates assets, WebGPU initialization, scene setup, and exposes condition preparation.
- Modify: `src/track-finishes.js` — `loadTrackFinishes(manager)` routes texture/HDR loads through the shared manager.
- Modify: `src/kart-view.js` — `loadKartBody(manager)` reports GLTF loads; register the local GLB fetch/parse as one real manager item.
- Modify: `src/main.js` — maps stage/progress callbacks to copy, serializes condition updates, and enables play only after initial preparation.
- Modify: `index.html` — add a dedicated accessible loading status within the menu and mark the condition controls busy while preparing.
- Modify: `src/style.css` — style the status and busy state in the existing visual system, including reduced-motion behavior.

**Interfaces:**
- `createWorld(canvas, track, {onProgress} = {})` calls `onProgress({stage, loaded, total, progress})`; asset events use real `loaded/total`, and stages without a measurable count omit those fields.
- `loadTrackFinishes(manager)` and `loadKartBody(manager)` use the same `THREE.LoadingManager` provided by `createWorld`.
- The returned world adds `prepareConditions(hour, wet, onProgress)`; it applies the requested condition and awaits `renderer.compileAsync(scene, camera, null, onProgress)`.
- Existing `setConditions(hour, wet)` remains available for restoring the last working selection after a preparation error.

- [x] **Step 1: Add a shared loading manager** in `createWorld` and pass it to track texture/HDR and kart GLTF loaders. Register the local GLB fetch/parse as a manager item, and emit factual `{stage: 'assets', loaded, total}` updates.
- [x] **Step 2: Start renderer setup beside asset loading** by creating the renderer initialization promise before awaiting the existing parallel asset promises. Emit named `renderer` and `scene` stages, then build the scene after both prerequisites resolve.
- [x] **Step 3: Add selected-condition preparation** to the returned world object. Apply one requested condition, await Three.js 0.187.0 `renderer.compileAsync(scene, camera, null, onProgress)`, and forward real pipeline progress as `{stage: 'pipelines', progress, total}`.
- [x] **Step 4: Add the menu loading status** with `role="status"` and polite live updates. In `src/main.js`, show asset counts and named WebGPU/scene/pipeline stages, then hide the status and enable “Entrar na pista” only after the initial selected condition has compiled and a complete frame has rendered.
- [x] **Step 5: Serialize weather and period changes**. Before preparation, show “Preparando chuva” or “Preparando iluminação”, set `aria-busy`, and disable both custom picker triggers. Let the status paint before calling `prepareConditions`; after success render a complete frame, commit the selection and saved preference, and restore the controls. On error, restore the previous condition and selection and show a recoverable status.
- [x] **Step 6: Inspect the primary startup and condition flows** in the local WebGPU browser: initial load, day, night, rain, and repeated distinct condition changes. Confirm no percentage is invented, controls stay disabled during preparation, and the complete prior scene remains visible until the next condition is ready. Cached repeat timing and forced-failure recovery were not measured.

### Task 4: Build and review the combined change

**Files:**
- Verify: `src/trackside-view.js`, `src/track-lighting.js`, `src/world.js`, `src/track-finishes.js`, `src/kart-view.js`, `src/main.js`, `index.html`, `src/style.css`.

- [x] **Step 1: Build the production site** with `npm run build`; resolve any build error caused by this change.
- [x] **Step 2: Review the final diff** against the approved spec and confirm unrelated worktree changes, `.local-assets/`, and local GLB routes remain untouched.
