/**
 * Loft.ts — skinning a set of cross-sections into one continuous surface.
 *
 * This is the modelling primitive the animals and the hunter are built from, and
 * it exists because the alternative does not work. A body assembled from
 * overlapping ellipsoids and capsules has visible seams wherever two masses
 * meet, cannot taper, and gives every limb the same thickness from shoulder to
 * wrist. A loft states the *profile* instead — a run of cross-sections, each
 * with its own width and depth — and skins one surface across them, which is
 * how a modelled figure is actually made.
 *
 * It was written for the tiger (see BigCat.ts) and moved here when the hunter
 * needed the same thing: a human torso is a lofted shape too, wide at the
 * shoulders, narrow at the waist, and neither of those is a sphere.
 *
 * Conventions worth knowing before using it:
 *
 *  • The surface runs along **+X**, always. A part that points somewhere else
 *    turns its *mesh*, rather than writing its stations along another axis —
 *    which keeps one lofting function serving a barrel, a neck, a leg, an arm
 *    and a tail.
 *  • `up` and `down` are separate radii, because bodies are not elliptical.
 *  • The UVs come out as `u` along the part and `v` around it, which is a
 *    ready-made parameterisation for a generated texture (see CatCoat.ts).
 *  • Both ends are capped, so a part is a solid object rather than a pipe.
 */

import * as THREE from 'three';

/**
 * One cross-section of a lofted part.
 *
 * `up` and `down` are separate radii because animals are not elliptical: a
 * cat's chest is deep below the spine and shallow above it, and its belly is
 * flatter than its back. Two radii cost nothing and are the difference between
 * a body and a tube.
 */
export interface Station {
  /** Position of the section's centre, along and above the part's axis. */
  x: number;
  y: number;
  z?: number;
  up: number;
  down: number;
  half: number;
}

/**
 * Skin a set of cross-sections into one continuous surface.
 *
 * The surface runs along +X. Both ends are closed with a fan so the part is a
 * solid object rather than a pipe. `colour` is called per vertex with its
 * position along the part (0..1) and around it (0 at the top, 1 at the bottom),
 * which is what lets the pattern be evaluated in the mesh.
 */
export function loft(
  stations: Station[],
  segments: number,
  /*
   * Optional, because not every lofted thing is patterned. The cat paints its
   * coat per vertex when it has no texture to wear; the hunter's trousers are
   * one colour and want no attribute at all — an unused colour buffer on every
   * cloth part is bytes uploaded to the GPU for nothing.
   */
  colour?: (along: number, down: number, lateral: number, at: number, out: THREE.Color) => void,
): THREE.BufferGeometry {
  const rings = stations.length;
  const positions: number[] = [];
  const colours: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const scratch = new THREE.Color();

  for (let i = 0; i < rings; i++) {
    const s = stations[i];
    const along = i / (rings - 1);
    for (let j = 0; j <= segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      const c = Math.cos(theta);
      const sn = Math.sin(theta);
      const y = s.y + c * (c >= 0 ? s.up : s.down);
      const z = (s.z ?? 0) + sn * s.half;
      positions.push(s.x, y, z);
      // 0 at the top of the section, 1 at the bottom, either side alike.
      const down = Math.acos(Math.max(-1, Math.min(1, c))) / Math.PI;
      /*
       * `down` cannot tell left from right — it is an angle from the top, and
       * both flanks are equally far round it — so the sine of the section angle
       * goes along too. A body does not care; a leg does, because it is white on
       * the inside face and orange on the outside.
       *
       * The last argument is one number standing for "where on the animal this
       * vertex is", which is all the colour function ever wanted the coordinates
       * for: a stable seed for mottling that does not repeat between parts.
       */
      if (colour) {
        colour(along, down, sn, s.x * 3.1 + y * 7.7 + z * 1.7, scratch);
        colours.push(scratch.r, scratch.g, scratch.b);
      }
      uvs.push(along, j / segments);
    }
  }

  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  // Caps: a fan to a point on the axis at each end, so nothing is hollow.
  const cap = (ring: number, station: Station, flip: boolean): void => {
    const centre = positions.length / 3;
    positions.push(station.x, station.y, station.z ?? 0);
    if (colour) {
      colour(flip ? 0 : 1, 0.5, 0, station.x * 3.1 + station.y * 7.7, scratch);
      colours.push(scratch.r, scratch.g, scratch.b);
    }
    uvs.push(flip ? 0 : 1, 0.5);
    for (let j = 0; j < segments; j++) {
      const a = ring * (segments + 1) + j;
      if (flip) indices.push(centre, a + 1, a);
      else indices.push(centre, a, a + 1);
    }
  };
  cap(0, stations[0], true);
  cap(rings - 1, stations[rings - 1], false);

  /*
   * ## Which way is out?
   *
   * The winding of a quad grid — and therefore the direction of every normal
   * derived from it — depends on whether the stations were listed front-to-back
   * or back-to-front. The body's run from the neck towards the tail and came out
   * facing outwards; the neck, skull, jaw and legs run the other way and came
   * out facing *inwards*, so they were lit from inside and rendered as pale
   * ambient-blue shapes. On a screenshot that looks like a colour bug, which is
   * exactly the wrong place to go looking.
   *
   * Rather than demand that every caller list its sections in one direction —
   * a rule that is invisible at the call site and would be broken again — the
   * surface measures its own signed volume and flips the winding if it came out
   * inside out.
   */
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const cc = indices[i + 2] * 3;
    // Six times the signed volume of the tetrahedron from the origin.
    volume +=
      positions[a] * (positions[b + 1] * positions[cc + 2] - positions[b + 2] * positions[cc + 1]) -
      positions[a + 1] * (positions[b] * positions[cc + 2] - positions[b + 2] * positions[cc]) +
      positions[a + 2] * (positions[b] * positions[cc + 1] - positions[b + 1] * positions[cc]);
  }
  if (volume < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const swap = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = swap;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colours.length > 0) {
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Interpolate a station list up to `count` sections, smoothing the profile. */
export function resample(key: Station[], count: number): Station[] {
  const out: Station[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * (key.length - 1);
    const i0 = Math.floor(t);
    const i1 = Math.min(key.length - 1, i0 + 1);
    // Smoothstep between control sections: a linear blend leaves a visible
    // crease at every one of them, which is the seam problem again in miniature.
    const raw = t - i0;
    const k = raw * raw * (3 - 2 * raw);
    const a = key[i0];
    const b = key[i1];
    out.push({
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
      z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * k,
      up: a.up + (b.up - a.up) * k,
      down: a.down + (b.down - a.down) * k,
      half: a.half + (b.half - a.half) * k,
    });
  }
  return out;
}


