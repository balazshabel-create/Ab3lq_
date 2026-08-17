/**
 * cat-probe.ts — what colour and shape did each part of the cat actually get?
 *
 *   npx tsx tools/cat-probe.ts
 *
 * A part that renders pale can be pale-coloured or it can be correctly coloured
 * and lit from the inside by inverted normals; a screenshot cannot tell the two
 * apart, and guessing between them costs a four-minute render each time. This
 * prints, per mesh: its bounding box, the mean vertex colour, and the fraction
 * of its normals that point away from the part's own axis — which is the
 * measurement that separates "painted wrong" from "inside out".
 */

import * as THREE from 'three';
import { buildAnimalModel } from '../src/Render/AnimalModels';
import { Species } from '../src/Animals/AnimalTypes';

const model = buildAnimalModel(Species.Tiger, 1);
model.root.updateMatrixWorld(true);

const rows: string[] = [];
let index = 0;
model.root.traverse((o) => {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh || !mesh.geometry) return;
  const g = mesh.geometry;
  g.computeBoundingBox();
  const box = g.boundingBox!;
  const colour = g.getAttribute('color');
  let r = 0;
  let gr = 0;
  let b = 0;
  if (colour) {
    for (let i = 0; i < colour.count; i++) {
      r += colour.getX(i);
      gr += colour.getY(i);
      b += colour.getZ(i);
    }
    r /= colour.count;
    gr /= colour.count;
    b /= colour.count;
  }

  /*
   * Are the normals pointing outwards? For a lofted tube the surface normal
   * should agree with the direction from the part's own centre to the vertex,
   * at least for the sides — if most of them disagree, the winding is reversed
   * and the part is being lit from inside.
   */
  const normal = g.getAttribute('normal');
  const position = g.getAttribute('position');
  const centre = new THREE.Vector3();
  box.getCenter(centre);
  let outward = 0;
  let counted = 0;
  if (normal && position) {
    for (let i = 0; i < position.count; i += 3) {
      const px = position.getX(i) - centre.x;
      const py = position.getY(i) - centre.y;
      const pz = position.getZ(i) - centre.z;
      const len = Math.hypot(px, py, pz);
      if (len < 1e-4) continue;
      const dot =
        (px / len) * normal.getX(i) + (py / len) * normal.getY(i) + (pz / len) * normal.getZ(i);
      if (dot > 0) outward++;
      counted++;
    }
  }

  const parents: string[] = [];
  let node: THREE.Object3D | null = mesh.parent;
  while (node && parents.length < 3) {
    parents.push(node.name || node.type);
    node = node.parent;
  }
  rows.push(
    `${String(index++).padStart(3)}  ` +
      `verts ${String(position?.count ?? 0).padStart(5)}  ` +
      `size ${box.max.x - box.min.x >= 0 ? (box.max.x - box.min.x).toFixed(2) : '?'}×` +
      `${(box.max.y - box.min.y).toFixed(2)}×${(box.max.z - box.min.z).toFixed(2)}  ` +
      `y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}  ` +
      `rgb ${r.toFixed(2)},${gr.toFixed(2)},${b.toFixed(2)}  ` +
      `outward ${counted ? Math.round((outward / counted) * 100) : 0}%  ` +
      `under ${parents.join('/')}`,
  );
});

console.log(rows.join('\n'));
console.log(`\nmeshes ${index}`);
