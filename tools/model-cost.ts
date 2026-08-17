/**
 * model-cost.ts — how many triangles and draw calls one animal costs.
 *
 *   npx tsx tools/model-cost.ts
 *
 * Detail is a budget, not a taste: the renderer gives a full-detail model to up
 * to forty animals at once, so a change that quietly triples a model triples
 * that. This counts what each species actually builds at both detail levels, so
 * "make it look real" can be checked against what it costs before it ships.
 */

import { buildAnimalModel } from '../src/Render/AnimalModels';
import type { Species } from '../src/Core/Types';
import { PLAYABLE_SPECIES } from '../src/Animals/AnimalTypes';
import * as THREE from 'three';

function count(species: Species, detail: number): { tris: number; meshes: number } {
  const model = buildAnimalModel(species, detail);
  let tris = 0;
  let meshes = 0;
  model.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    meshes++;
    const index = m.geometry.getIndex();
    const pos = m.geometry.getAttribute('position');
    tris += index ? index.count / 3 : pos ? pos.count / 3 : 0;
  });
  return { tris: Math.round(tris), meshes };
}

const species = [...PLAYABLE_SPECIES, 'hunter' as Species];
console.log('species        near tris  near meshes   far tris  far meshes');
for (const s of species) {
  const near = count(s, 1);
  const far = count(s, 0.3);
  console.log(
    `${String(s).padEnd(14)} ${String(near.tris).padStart(9)} ${String(near.meshes).padStart(12)} ` +
      `${String(far.tris).padStart(10)} ${String(far.meshes).padStart(11)}`,
  );
}
