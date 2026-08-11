/**
 * camera.test.ts — the camera rig, run headless.
 *
 * The rig is renderer-side code, so it lives outside simulation.test.ts, but it
 * needs no DOM: three.js's maths and camera classes work fine in Node, and the
 * rig's only renderer dependency (`AnimalRenderer`) is a *type* import, so a stub
 * with two methods satisfies it.
 *
 * Worth testing rather than eyeballing, because the bug this covers was invisible
 * from the code and expensive to see in play: the camera silently refused to
 * follow a diving animal, so the whole underwater view existed and could never be
 * reached.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CameraRig } from '../src/Player/CameraRig';
import { Terrain } from '../src/World/Terrain';
import { Species, ANIMALS } from '../src/Animals/AnimalTypes';
import { AnimalRenderer } from '../src/Render/AnimalRenderer';
import { presetSettings } from '../src/Graphics/QualitySettings';
import { WATER_LEVEL } from '../src/Systems/Config';

/**
 * A stand-in for the AnimalRenderer: the rig only ever asks it where the target
 * is and whether it is under the surface.
 */
function stubAnimals(pos: THREE.Vector3, submerged: boolean): AnimalRenderer {
  return {
    getPosition(_id: number, out: THREE.Vector3): boolean {
      out.copy(pos);
      return true;
    },
    isSubmerged(): boolean {
      return submerged;
    },
  } as unknown as AnimalRenderer;
}

/** The deepest water this seed has, so the dive has somewhere to happen. */
function deepestWater(terrain: Terrain): { x: number; z: number; depth: number } {
  let best = { x: 0, z: 0, depth: 0 };
  for (let i = 0; i < 40_000; i++) {
    const a = i * 2.399963;
    const r = Math.sqrt((i % 997) / 997) * 420;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const depth = terrain.waterDepthAt(x, z);
    if (depth > best.depth) best = { x, z, depth };
  }
  return best;
}

/** Settle the rig, which follows its target through a critically damped lerp. */
function settle(rig: CameraRig, animals: AnimalRenderer, seconds = 6): void {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) rig.update(dt, animals);
}

test('the camera follows a submerged animal below the surface', () => {
  const terrain = new Terrain(4242);
  const spot = deepestWater(terrain);
  assert.ok(spot.depth > 2, `seed has no deep water (best ${spot.depth.toFixed(2)}m)`);

  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 2000);
  const rig = new CameraRig(camera, terrain);
  rig.setTarget(1);
  rig.setSpecies(Species.Caiman);
  rig.setFreeMode(false);
  // Look level, so the boom is roughly horizontal rather than up in the air.
  rig.addLook(0, -0.38);

  /*
   * Where a submerged caiman actually sits: the movement solver puts it on the
   * bed, half a body height up. Mirroring that here rather than picking a depth
   * keeps the test honest about the case the rig has to handle.
   */
  const bed = terrain.heightAt(spot.x, spot.z);
  const height = ANIMALS[Species.Caiman].silhouette.height;
  const animalY = bed + height * 0.5;
  assert.ok(
    animalY < WATER_LEVEL - 0.5,
    `a submerged caiman should be well under the surface, was at ${animalY.toFixed(2)}m`,
  );

  const pos = new THREE.Vector3(spot.x, animalY, spot.z);
  const animals = stubAnimals(pos, true);
  settle(rig, animals);

  assert.ok(
    rig.underwater,
    `the camera stayed above water (y=${camera.position.y.toFixed(2)}, water line ${WATER_LEVEL}) ` +
      'while following a submerged animal, so the underwater view can never engage',
  );
  assert.ok(
    camera.position.y < WATER_LEVEL,
    `camera y ${camera.position.y.toFixed(2)} should be under the water line ${WATER_LEVEL}`,
  );
  // It must not sink through the river bed either.
  assert.ok(
    camera.position.y > terrain.heightAt(camera.position.x, camera.position.z) - 0.01,
    'the camera dropped below the river bed',
  );
});

test('the camera stays above water for an animal swimming on the surface', () => {
  /*
   * The other half of the contract. Lifting the camera's floor to the bed while
   * submerged must not leak into normal swimming — a capybara paddling across
   * the river should still be filmed from above the surface, or every water
   * crossing would turn the screen green.
   */
  const terrain = new Terrain(4242);
  const spot = deepestWater(terrain);

  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 2000);
  const rig = new CameraRig(camera, terrain);
  rig.setTarget(1);
  rig.setSpecies(Species.Capybara);
  rig.setFreeMode(false);
  rig.addLook(0, -0.38);

  const height = ANIMALS[Species.Capybara].silhouette.height;
  const pos = new THREE.Vector3(spot.x, WATER_LEVEL - height * 0.25, spot.z);
  settle(rig, stubAnimals(pos, false));

  assert.equal(
    rig.underwater,
    false,
    `the camera went under (y=${camera.position.y.toFixed(2)}) for an animal at the surface`,
  );
});

test('a steep bank never launches an animal into the air', () => {
  /*
   * The bug this pins down: walking up to the reeds at the water's edge lifted
   * your animal several metres off the ground, where it hung with its legs
   * dangling.
   *
   * The cause was the terrain-following clearance in AnimalRenderer. It samples
   * the ground one body-length fore and aft and raises the animal so neither end
   * dips below the surface — but the body pitch is clamped to 32°, so at the foot
   * of a steep bank the body stayed level while the forward sample ran away
   * upwards, and the correction lifted the animal by the whole height of the
   * bank. Deepening the river made the banks steeper and turned it from an
   * occasional oddity into something reproducible.
   *
   * Driven through the real renderer with a synthetic ground sampler, because the
   * failure is a function of the height *difference* between the samples and
   * nothing else — a cliff in a flat world reproduces it exactly.
   */
  const scene = new THREE.Scene();
  const settings = presetSettings('high');
  const animals = new AnimalRenderer(scene, settings);

  // A world that is flat at z <= 0 and a sheer 12 m wall beyond it.
  animals.setGroundSampler((_x: number, z: number) => (z > 0 ? 12 : 0));
  // Nothing is in water here; the clearance only runs for animals on ground.
  animals.setWaterTest(() => false);

  const species = Species.Caiman;
  animals.applySnapshot([
    {
      id: 1,
      species,
      // Standing on the flat, facing the wall.
      x: 0,
      y: 0,
      z: -0.2,
      yaw: Math.PI / 2,
      gait: 0,
      flags: 0,
      flies: 0,
    },
  ]);

  const cameraPos = new THREE.Vector3(0, 2, -8);
  for (let i = 0; i < 120; i++) animals.update(1 / 60, cameraPos, i / 60);

  const root = scene.getObjectByName('animals')?.children[0];
  assert.ok(root, 'the animal was never drawn');

  /*
   * The legitimate correction is bounded by the geometry it exists to cancel:
   * half a body length times sin(32°). Anything much above that is the animal
   * levitating up the wall.
   */
  const reach = Math.max(0.25, ANIMALS[species].silhouette.length * 0.42);
  const allowed = reach * Math.sin(0.56) + 0.05;
  assert.ok(
    root!.position.y <= allowed,
    `the animal was lifted to y=${root!.position.y.toFixed(2)} beside a 12 m wall; ` +
      `the clearance should never exceed ${allowed.toFixed(2)}m`,
  );
});
