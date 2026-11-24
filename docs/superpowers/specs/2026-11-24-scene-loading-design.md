# MOTOR LAB RACING: scene and loading improvements

**Status:** Approved; implementation complete
**Date:** 2026-11-24

## Intent

Make the existing WebGPU circuit feel more grounded around the kart, keep every night floodlight neutral white, and make initial loading and condition changes feel deliberate instead of appearing stalled or partially rendered.

## Current behavior and constraints

- The scene already uses instanced woodland and verge grass, detailed asphalt, curbs, tire barriers, fencing, and a paddock. The most useful visual gain is variation close to the track edge rather than replacing the entire environment.
- Startup waits for track textures/HDR and the kart model before initializing WebGPU and building the scene. The local Racer GLB is about 20 MB; the track loads several texture and HDR files in parallel. The menu currently shows only “Carregando circuito…”.
- Changing weather or period fetches no new assets, but changes light/shadow visibility and rain state. Those changes can require new WebGPU pipelines. The menu does not report this work and may show an incomplete frame until the pipeline is ready.
- Floodlight slots alternate between yellow and blue-white. The slots are reused for the nearest track lights, so one physical post can change color as the kart moves.
- Preserve the current first-person view, WebGPU-only renderer, existing assets, controls, lap timing, and local GLB routes. Add no package dependencies or new large art assets.

## Goals

1. Add visible, believable variation along the road shoulder using existing textures/materials and instanced or batched geometry.
2. Keep floodlight emitters, their light sources, and their glow consistently neutral white from their first visible frame. Retain the dark blue night ambience in the sky and shadows.
3. Reduce avoidable startup latency by initializing WebGPU while track and kart assets load in parallel.
4. Show truthful loading stages for asset loading, WebGPU/scene setup, and shader-pipeline preparation. Use file counts or the renderer's real pipeline progress; never invent a combined percentage.
5. On weather/period changes, show an accessible busy state before applying/compiling the new condition, keep the controls from launching overlapping changes, render a complete frame, then clear the state. Reuse cached pipelines for later selections.

## Approaches considered

1. **Balanced polish (selected):** enrich nearby track edges with reusable geometry/materials, fix floodlights to neutral white, overlap renderer initialization with existing asset loading, and prepare only the chosen condition with an explicit progress state. This addresses the requested visual and loading problems without downloading more assets or making cold startup wait for all six combinations.
2. **Precompile every weather/period combination at startup:** makes later switches fast, but lengthens the initial wait and raises GPU compilation/memory cost before the player can start.
3. **Replace or substantially expand the environment assets:** offers the largest visual change, but requires asset sourcing/validation and is likely to increase download and startup cost.

The user selected **Balanced polish**. Fine-grained choices about the exact shoulder props and status copy are left to implementation, provided they follow the current visual language and keep performance in view.

## Proposed behavior

### Trackside visual pass

Vary the transition from asphalt to gravel and grass with irregular low vegetation, gravel patches, and a small number of well-placed trackside markers. Reuse existing textures, colors, and instancing/batching patterns. Keep props outside the kart's running line and avoid adding dynamic lights, high-poly scenery, or new external assets.

### Night lighting

Use one neutral white color for every floodlight slot, bulb emitter, and glow. Do not let slot ordering determine a physical post's color. Keep the night sky and ambient fill cool/dark so the scene remains recognizably nighttime; they must not tint the lamps yellow.

### Startup and condition loading

Expose an accessible status region in the existing menu. Report asset counts from the loader manager, then named WebGPU/scene and pipeline-preparation stages. Start renderer initialization alongside the existing parallel asset requests. Prepare the initially selected condition before enabling “Entrar na pista”.

When a player changes weather or period, paint a “Preparando chuva” or “Preparando iluminação” state first, mark the relevant controls busy/disabled, apply the condition, await `renderer.compileAsync` for the current view, render one complete frame, and then clear the state. If compilation fails, restore the last working selection and show a recoverable message. Do not precompile all combinations.

## Non-goals and anti-goals

- No replacement of the circuit, kart, driver, or camera.
- No new GLB/HDR/texture download, external dependency, or public asset publication.
- No fake progress percentage, hidden multi-second freeze, yellow/blue alternating floodlights, or partial scene shown as ready.
- No change to driving physics, lap records, sound, or input controls.

## Acceptance checks

- The shoulder reads as more varied and natural in the existing view without visibly crowding the racing line.
- All active night floodlights appear neutral white and do not change hue when the kart passes between posts.
- Startup exposes real loading stages and only enables play after the selected initial scene is prepared.
- Selecting rain/night shows its busy state before compilation begins, then reveals a complete scene; repeat selection reuses prepared pipelines when available.
- Keyboard/screen-reader status remains understandable, and existing menu and gameplay controls still work.

## Implementation calls

- Keep the current environment art direction and use existing instancing/batching helpers.
- Use actual loader counts and WebGPU pipeline progress where available; use named stages when byte-level progress is unavailable.
- Prepare the selected condition on demand and retain renderer-cached pipelines rather than compiling all variants on startup.
- Verify by building and inspecting the day, night, rain, and condition-switch flows in the local WebGPU browser. Do not add automated tests unless requested.
