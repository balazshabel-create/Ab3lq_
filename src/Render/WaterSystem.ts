/**
 * WaterSystem.ts — the rivers.
 *
 * The water matters mechanically: crocodiles own it, capybaras escape into it,
 * and a submerged animal is nearly invisible. So it has to read clearly as
 * *water* — reflective, moving, and with a visible depth gradient so players can
 * judge where it stops being wadeable.
 *
 * Implemented as a custom shader rather than a stock material because it needs
 * three things at once: a fresnel sky reflection, animated surface normals from
 * two crossing wave sets, and a shoreline fade that hides the hard intersection
 * with the terrain. On the LOW preset the whole thing collapses to a flat
 * translucent plane.
 */

import * as THREE from 'three';
import {
  WATER_DEPTH_ABOVE,
  WATER_DEPTH_BAND,
  WATER_LEVEL,
  WORLD_SIZE,
} from '../Systems/Config';
import type { GraphicsSettings } from '../Graphics/QualitySettings';

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uWaveScale;
  varying vec2 vWorldXZ;
  varying vec3 vWorldPos;
  varying float vWave;

  // Three's own fog plumbing. A custom ShaderMaterial does not get it for free,
  // which is exactly how the water ended up as the only unfogged surface in the
  // game — see the note in the fragment shader.
  #include <fog_pars_vertex>

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldXZ = world.xz;
    vWorldPos = world.xyz;

    // Two crossing wave trains, plus a slow swell. Cheap, and enough to make
    // the surface read as flowing rather than sloshing in place.
    float w1 = sin(world.x * 0.19 + uTime * 1.10) * 0.075;
    float w2 = sin(world.z * 0.25 - uTime * 0.85) * 0.062;
    float swell = sin((world.x + world.z) * 0.045 + uTime * 0.35) * 0.115;
    /*
     * Three trains, not four. A fourth at 10 m wavelength was added here to
     * break up the beat pattern and it aliased immediately: the plane carries a
     * vertex every 5.7 m, so a 10 m wave is sampled twice per cycle and comes
     * out as diagonal stair-steps across the river. Anything finer than the mesh
     * belongs in the normal, which has no resolution limit — see waveNormal.
     */
    float wave = (w1 + w2 + swell) * uWaveScale;
    vWave = wave;

    world.y += wave;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform vec3 uSkyColor;
  uniform vec3 uZenithColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform vec3 uCameraPos;
  uniform float uTime;
  uniform float uReflectivity;
  uniform float uOpacity;
  uniform float uRain;
  uniform sampler2D uDepthMap;
  uniform float uWorldSize;
  uniform float uUnderwater;
  uniform float uDepthZero;
  uniform float uDepthBand;

  varying vec2 vWorldXZ;
  varying vec3 vWorldPos;
  varying float vWave;

  /*
   * Fog.
   *
   * A ShaderMaterial gets none of three's standard plumbing unless it asks, and
   * for a long time this one did not ask. The consequence only showed up in fog
   * weather, and it was severe: every other surface in the game faded into the
   * fog colour while the river stayed perfectly crisp, so the water read as a
   * flat white sheet laid over a grey world. A river is not less atmospheric than
   * the ground next to it.
   */
  #include <fog_pars_fragment>

  /*
   * Reconstruct a surface normal analytically — no normal map, no texture fetch.
   *
   * The vertex shader only displaces three long, smooth wave trains, because that
   * is all the mesh has the resolution to carry. The *normal* is not limited by
   * mesh resolution, so it gets four extra octaves of much finer ripple on top:
   * detail the surface does not actually have geometrically, but which is what the
   * eye reads as water rather than as a tilted sheet. Cross-hatched at
   * non-parallel angles and at frequencies that are not multiples of each other,
   * so the pattern never visibly tiles.
   */
  /*
   * Raindrops landing on the water.
   *
   * One drop per cell of a grid, each launching an expanding ring at its own
   * phase, three grids at different scales and offsets laid over each other so
   * the impacts do not fall in rows. This is what makes rain *land* — the
   * curtain of drops in the air passes straight through a river otherwise, and
   * the surface stays glassy through a downpour.
   *
   * Returns a 0..1 mask of ring brightness.
   */
  float rainRings(vec2 p, float t) {
    float total = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 q = p * (1.0 + fi * 0.63) + vec2(fi * 7.3, fi * 3.1);
      vec2 cell = floor(q);
      vec2 f = fract(q) - 0.5;
      float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
      // Each drop waits its turn: the fractional phase is its own clock.
      float phase = fract(t * (1.3 + h * 0.7) + h);
      float radius = phase * 0.46;
      float ring = smoothstep(0.07, 0.0, abs(length(f) - radius));
      // Rings fade as they widen, the way a real one loses height.
      total += ring * (1.0 - phase) * (1.0 - phase) * 0.6;
    }
    return clamp(total, 0.0, 1.0);
  }

  /*
   * Wave height at a point, per pixel.
   *
   * The vertex shader hands down its own displacement in vWave, but that is a
   * varying: it is linear across a triangle, and the water plane's triangles
   * are nearly six metres wide. Anything keyed on it — crest foam, the light
   * that scatters through a crest — comes out as hard chevrons that follow the
   * mesh instead of the water. Evaluating the same three trains here costs
   * three sines and follows the surface exactly.
   */
  float waveHeight(vec2 p) {
    return sin(p.x * 0.19 + uTime * 1.10) * 0.075
         + sin(p.y * 0.25 - uTime * 0.85) * 0.062
         + sin((p.x + p.y) * 0.045 + uTime * 0.35) * 0.115;
  }

  vec3 waveNormal(vec2 p, float detail) {
    float dx = cos(p.x * 0.19 + uTime * 1.10) * 0.19 * 0.075
             + cos((p.x + p.y) * 0.045 + uTime * 0.35) * 0.045 * 0.115
             + cos((p.x * 0.63 - p.y * 0.41) + uTime * 0.62) * 0.63 * 0.035;
    float dz = cos(p.y * 0.25 - uTime * 0.85) * 0.25 * -0.062
             + cos((p.x + p.y) * 0.045 + uTime * 0.35) * 0.045 * 0.115
             - cos((p.x * 0.63 - p.y * 0.41) + uTime * 0.62) * 0.41 * 0.035;

    /*
     * Fine chop, faded out with distance by 'detail'.
     *
     * The fade is not an optimisation, it is the fix for a real artefact. A ripple
     * with a wavelength under a metre covers less than a pixel once the water is
     * thirty metres away, so the shader samples it essentially at random from one
     * pixel to the next — and with a sharp specular lobe on top, "slightly
     * different normal" means "wildly different brightness". The result was a
     * shimmering cross-hatch across the whole river, which is aliasing: detail
     * finer than the pixel grid can resolve. Mip-mapping solves this for textures;
     * for procedural normals you have to fade the octaves out by hand.
     *
     * Amplitudes also fall off as frequency rises, which is what keeps the sum
     * looking like water rather than corrugated iron.
     */
    dx += cos(p.x * 1.31 + p.y * 0.42 + uTime * 2.3) * 0.020 * detail;
    dz += cos(p.y * 1.19 - p.x * 0.37 - uTime * 2.1) * 0.020 * detail;
    dx += cos(p.x * 2.87 - p.y * 1.13 + uTime * 3.7) * 0.011 * detail * detail;
    dz += cos(p.y * 3.11 + p.x * 0.91 - uTime * 3.3) * 0.011 * detail * detail;

    // Ripples from rain, which visibly roughen the surface during a storm.
    float r = uRain * 0.35 * detail;
    dx += sin(p.x * 5.0 + uTime * 9.0) * r * 0.02;
    dz += sin(p.y * 5.3 - uTime * 8.0) * r * 0.02;
    return normalize(vec3(-dx * 6.0, 1.0, -dz * 6.0));
  }

  void main() {
    /*
     * Water depth comes from a baked texture of the terrain heightfield, so the
     * shader knows where the shallows are without any CPU work per frame.
     *
     * The texture stores ground height normalised over a 7 m band centred on the
     * water line, so the water line itself sits at 1/7 of the range, not at
     * zero. Getting that wrong is not subtle: the water plane spans the entire
     * map, so treating dry land as "zero depth" drew a 35%-opacity white sheet
     * over the whole world and washed every scene out to grey.
     */
    vec2 uv = vWorldXZ / uWorldSize + 0.5;
    float ground = texture2D(uDepthMap, uv).r;
    /*
     * Metres of water above the ground. Negative on dry land.
     *
     * The two constants come in as uniforms rather than being written here.
     * They used to be a literal 0.142857 and a literal 7.0 that silently encoded
     * the baker's mapping, so deepening the river meant editing the same numbers
     * in two files and the first symptom of getting it wrong is a translucent
     * sheet drawn over the entire map.
     */
    float depthM = ((1.0 - ground) - uDepthZero) * uDepthBand;
    // Anywhere the terrain rises above the water line, there is simply no water.
    if (depthM <= 0.0) discard;

    /*
     * --- Which way the river is going ------------------------------------
     *
     * This is a *river*, and until now it did not move anywhere: the wave trains
     * crossed each other in place, which is what a lake does. A flowing surface
     * is one of the few things the eye reads instantly and unconsciously, and
     * getting it wrong made a fast-moving channel feel like standing water no
     * matter how good the highlights on it were.
     *
     * The direction is taken from the depth map rather than baked in as a
     * constant, and that is the trick worth keeping: the gradient of the water
     * depth points straight *across* the channel, from the deep middle towards
     * the nearer bank — so rotating it a quarter turn gives the direction the
     * channel runs, at every point, following every bend, for the price of two
     * texture fetches and no CPU work at all.
     */
    float texel = 2.0 / uWorldSize;
    float gx = texture2D(uDepthMap, uv + vec2(texel, 0.0)).r
             - texture2D(uDepthMap, uv - vec2(texel, 0.0)).r;
    float gz = texture2D(uDepthMap, uv + vec2(0.0, texel)).r
             - texture2D(uDepthMap, uv - vec2(0.0, texel)).r;
    vec2 across = vec2(gx, gz);
    // Perpendicular to the cross-channel gradient, normalised safely: in the
    // exact middle of a straight reach the gradient is zero, and a normalize()
    // there would produce NaNs across a whole band of the river.
    vec2 flow = length(across) > 1e-5 ? normalize(vec2(-across.y, across.x)) : vec2(1.0, 0.0);
    // Faster in the deep middle than in the shallows, the way water actually is.
    float current = 0.35 + 0.65 * clamp(depthM / 2.5, 0.0, 1.0);
    vec2 drift = vWorldXZ - flow * uTime * 1.9 * current;

    // How much fine surface detail this pixel can actually resolve.
    float camDist = length(uCameraPos - vWorldPos);
    float detail = 1.0 - smoothstep(10.0, 48.0, camDist);

    vec3 normal = waveNormal(drift, detail);
    vec3 viewDir = normalize(uCameraPos - vWorldPos);

    /*
     * Seen from below, the surface is a different thing entirely.
     *
     * Looking up from under water you do not see a translucent sheet with the
     * river bed behind it — you see a bright, rippling ceiling, mostly total
     * internal reflection with a lighter disc overhead (Snell's window). Running
     * the normal above-water path from underneath produces a murky grey film that
     * reads as a bug, so this takes its own branch and returns early.
     */
    if (uUnderwater > 0.5) {
      // How steeply we are looking at the surface. Straight up = 1.
      float up = clamp(abs(viewDir.y), 0.0, 1.0);
      // Snell's window: the world above is only visible within a cone. Outside
      // it the surface mirrors the dark water back down at you.
      float window = smoothstep(0.32, 0.78, up);
      vec3 mirrored = uDeepColor * 1.15;
      vec3 through = mix(uShallowColor, uSkyColor, 0.72);
      vec3 under = mix(mirrored, through, window);
      // Wave crests catch the light from underneath as bright rippling bands.
      float shimmer = pow(max(dot(normal, vec3(0.0, 1.0, 0.0)), 0.0), 28.0);
      under += uSunColor * shimmer * 0.5 * window;
      gl_FragColor = vec4(under, 0.92);
      #include <fog_fragment>
      #include <colorspace_fragment>
      return;
    }

    /*
     * --- Fresnel ----------------------------------------------------------
     *
     * Schlick, with water's real F0 of 0.02, rather than the hand-shaped mix
     * this used to be. That means a surface seen straight down is almost
     * entirely transparent and one seen edge-on is almost entirely mirror,
     * which is the single most recognisable thing about water and the reason a
     * river reads as wet from a bank and as glass from a bridge.
     *
     * It is then pulled back down over deep water. Physically a surface does
     * approach a perfect mirror at grazing incidence, and letting it do that
     * here turned the river into a sheet of pale sky. This is a silt-laden
     * tributary: what comes back from deep water is mostly the water itself,
     * however flat you look at it.
     */
    float cosTheta = clamp(dot(viewDir, normal), 0.0, 1.0);
    float schlick = 0.02 + 0.98 * pow(1.0 - cosTheta, 5.0);
    float deepness = clamp(depthM / 4.0, 0.0, 1.0);
    float fresnel = min(schlick, 0.72 - deepness * 0.22) * uReflectivity;

    /*
     * --- What comes up from below -----------------------------------------
     *
     * Beer-Lambert, not a lerp between two colours.
     *
     * Light that goes into water is absorbed at a rate that depends on its
     * wavelength: red is gone within a metre or two, green survives several,
     * blue furthest of all. That per-channel falloff is *why* water looks the
     * way it does, and interpolating between a shallow colour and a deep one
     * only ever approximates the midpoint of it. Exponential extinction gives
     * the whole curve for the same cost: clear over a sandbar, green at chest
     * depth, and near-black in the channel, with no threshold anywhere.
     *
     * The coefficients are for a silty tributary rather than a lagoon — this
     * water has things suspended in it, so everything dies faster than it would
     * in the sea and green outlives blue.
     */
    vec3 extinction = vec3(1.15, 0.42, 0.62);
    vec3 transmit = exp(-extinction * depthM);
    // The bed shows through the shallows; the scatter colour is what the water
    // itself sends back once the bed is out of reach.
    vec3 body = uShallowColor * transmit + uDeepColor * (1.0 - transmit);

    /*
     * Sunlight scattered *inside* a wave.
     *
     * A wave crest is thin enough for light to pass through it, and that is the
     * bright green-gold edge every photograph of water has along the top of a
     * ripple. Keyed on the crest height and on looking towards the sun, which
     * is when the light is actually coming through the wave at you.
     */
    float crest = waveHeight(vWorldXZ);
    float towardsSun = pow(max(dot(-viewDir, uSunDirection), 0.0), 3.0);
    float crestLift = smoothstep(0.06, 0.2, crest);
    body += uSunColor * uShallowColor * towardsSun * crestLift * max(uSunDirection.y, 0.0) * 0.5;

    /*
     * --- What comes off the top -------------------------------------------
     *
     * The sky, sampled in the direction the surface actually reflects, instead
     * of one flat colour for the whole river. It costs two mixes and it is what
     * puts a bright horizon band on the far water and a deeper blue on the near
     * water, which is most of what makes a real surface read as a surface.
     */
    vec3 mirror = reflect(-viewDir, normal);
    float up = clamp(mirror.y, 0.0, 1.0);
    vec3 sky = mix(uSkyColor, uZenithColor, pow(up, 0.45));

    /*
     * Sun glitter, as a microfacet lobe rather than a power of N·H.
     *
     * GGX has a narrow core and a wide tail, which is exactly the shape of a
     * glitter path: a hard spark where a wavelet faces the sun squarely, and a
     * broad sheen stretching away from it. Two hand-tuned exponents were
     * standing in for that and could never have both at once.
     *
     * Roughness grows with distance, and that is not a stylistic choice: a
     * ripple finer than a pixel cannot be resolved, and a sharp lobe on top of
     * an unresolvable normal is the definition of specular aliasing. Blurring
     * the highlight exactly as far as the ripples are faded keeps the far water
     * calm instead of boiling.
     */
    vec3 halfway = normalize(uSunDirection + viewDir);
    float ndh = max(dot(normal, halfway), 0.0);
    float rough = mix(0.2, 0.06, detail);
    float a = rough * rough;
    float d = (ndh * ndh) * (a * a - 1.0) + 1.0;
    float ggx = (a * a) / max(1e-4, 3.14159 * d * d);
    /*
     * Capped. An un-clamped GGX peak at this roughness is around twenty-four,
     * and multiplied through even a small Fresnel that is a blown-out white
     * blob the size of a boat rather than a glint. The cap costs nothing at the
     * distances that matter and keeps the highlight inside the range the tone
     * mapper can still resolve as a shape.
     */
    float sunUp = clamp(uSunDirection.y * 4.0, 0.0, 1.0);
    vec3 reflection = sky + uSunColor * min(ggx, 7.0) * 0.5 * sunUp;

    vec3 color = mix(body, reflection, fresnel);

    /*
     * Silt.
     *
     * A slow, large-scale brightness drift across the surface, tied to world
     * position rather than to the waves. An Amazon tributary is loaded with
     * sediment and is visibly not one uniform colour; without this the river reads
     * as a flat plane of paint no matter how good the highlights are.
     */
    float silt = sin(vWorldXZ.x * 0.031 + uTime * 0.06) * sin(vWorldXZ.y * 0.027 - uTime * 0.045);
    color *= 1.0 + silt * 0.13;

    /*
     * --- Caustics ---------------------------------------------------------
     *
     * The net of dancing light on a river bed, and the single most recognisable
     * thing about shallow sunlit water. There is no bed geometry to project onto
     * here — the terrain is drawn by its own material — but the effect still
     * lands, because what you actually see from above is the light *coming back
     * up through* the water, and brightening the water where the caustic net is
     * bright is very nearly the same image.
     *
     * Built from two crossing sine fields raised to a high power: the product of
     * two |sin| fields is bright only where both are near their peaks, which is a
     * network of thin curved lines meeting at knots — the caustic pattern. Driven
     * by the drifted coordinate, so the net travels downstream with the water
     * instead of sitting still on top of a moving surface.
     */
    float caustic = 0.0;
    if (depthM < 3.0) {
      vec2 cp = drift * 0.55;
      float a = sin(cp.x * 1.7 + sin(cp.y * 0.9 + uTime * 0.7) * 1.6 + uTime * 0.9);
      float b = sin(cp.y * 1.9 + sin(cp.x * 1.1 - uTime * 0.6) * 1.4 - uTime * 1.1);
      caustic = pow(abs(a * b), 5.0);
      // Strongest just under the surface and gone by waist depth, and only where
      // the sun is actually on the water.
      float shallow = 1.0 - smoothstep(0.4, 3.0, depthM);
      caustic *= shallow * detail * max(uSunDirection.y, 0.0);
    }
    color += uSunColor * caustic * 0.55;

    /*
     * Foam on the crests, and a wet band in the last half metre of shallows.
     *
     * Both kept deliberately weak. The wave amplitude is around fifteen
     * centimetres and the swell is smooth over tens of metres, so a low crest
     * threshold does not pick out crests — it whitens roughly a third of the
     * river at once, and the result is a milky sheet rather than water.
     */
    // Threshold retuned with the wave amplitude: the trains now sum to about
    // forty centimetres rather than eighteen, and the old threshold whitened a
    // third of the river at once.
    /*
     * From the per-pixel field, not from the interpolated vertex height — and
     * from the very top of it only.
     *
     * The three trains sum to a peak of 0.25, so a threshold at 0.17 whitened
     * the top third of every swell: ten-metre pale discs scattered across the
     * lake that read as mist on the surface rather than as foam. Real crest
     * foam happens where a wave is actually breaking, which on water this calm
     * is almost nowhere.
     */
    float foamCrest = smoothstep(0.225, 0.25, crest);
    float shore = 1.0 - smoothstep(0.0, 0.5, depthM);
    color += vec3(0.26) * foamCrest * 0.22;
    color = mix(color, vec3(0.58, 0.59, 0.52), shore * 0.32);

    /*
     * Moving foam along the waterline.
     *
     * The wet band above is static — it marks where the shallows are and then
     * sits there. Water at a bank is never still: it gathers and thins in bands
     * that slide along the shore. One band of animated noise riding the flow,
     * confined to the last few tens of centimetres of depth, and the edge of the
     * river stops looking like a line drawn on the ground.
     */
    float edge = (1.0 - smoothstep(0.0, 0.35, depthM)) * smoothstep(0.0, 0.08, depthM);
    float lace = sin(dot(drift, flow) * 2.3 + uTime * 1.2)
               * sin(dot(drift, vec2(-flow.y, flow.x)) * 3.7 - uTime * 0.8);
    color += vec3(0.5, 0.52, 0.48) * edge * smoothstep(0.1, 0.75, abs(lace)) * 0.55;

    /*
     * Rain, landing. Faded with the same detail term as every other fine
     * feature here — a ring twenty centimetres across is sub-pixel at forty
     * metres, and drawing it there is just noise.
     */
    if (uRain > 0.02) {
      /*
       * Quiet. At half strength three overlapping ring grids brightened most of
       * the surface most of the time, and a river in a downpour came out milky
       * — which is the opposite of what rain does to water. The rings are meant
       * to be read as individual impacts, so they have to sit *under* the
       * surface colour rather than over it.
       */
      float rings = rainRings(vWorldXZ * 1.7, uTime);
      color += vec3(0.62, 0.66, 0.62) * rings * uRain * detail * 0.2;
    }

    // Shallow water is nearly clear; deep water hides what is under it.
    float alpha = uOpacity * (0.3 + 0.7 * clamp(depthM / 1.2, 0.0, 1.0));
    alpha = mix(alpha, 1.0, fresnel * 0.5);
    // Feather the very edge so the plane never shows a hard outline.
    alpha *= smoothstep(0.0, 0.12, depthM);

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));

    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

export class WaterSystem {
  readonly mesh: THREE.Mesh;
  private geometry: THREE.PlaneGeometry;
  private material: THREE.ShaderMaterial;
  private simpleMaterial: THREE.MeshLambertMaterial;
  private depthTexture: THREE.DataTexture;
  private quality: GraphicsSettings['waterQuality'];

  constructor(depthMap: THREE.DataTexture, settings: GraphicsSettings) {
    this.depthTexture = depthMap;
    this.quality = settings.waterQuality;

    // Segment count only matters for the vertex wave displacement.
    const segments = settings.waterQuality === 'high' ? 160 : settings.waterQuality === 'medium' ? 96 : 1;
    this.geometry = new THREE.PlaneGeometry(WORLD_SIZE * 1.15, WORLD_SIZE * 1.15, segments, segments);
    this.geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      // `fog: true` is what makes three inject the fog uniforms and defines that
      // the #include chunks above depend on.
      fog: true,
      uniforms: {
        /*
         * Spread three's fog uniforms in rather than using UniformsUtils.merge.
         * Merge deep-clones every value, and `cloneUniforms` clones textures too —
         * which would silently duplicate the water depth map onto the GPU and
         * leave `dispose()` releasing the original while the clone leaked.
         */
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: { value: 0 },
        uWaveScale: { value: settings.waterQuality === 'low' ? 0 : 1 },
        uShallowColor: { value: new THREE.Color(0x53704a) },
        uDeepColor: { value: new THREE.Color(0x1d3a2f) },
        uSkyColor: { value: new THREE.Color(0x88a7c4) },
        uZenithColor: { value: new THREE.Color(0x4a7fb5) },
        uSunColor: { value: new THREE.Color(0xffe8c0) },
        uSunDirection: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
        uCameraPos: { value: new THREE.Vector3() },
        // Below 1: a fully reflective surface turns the whole mid-distance of
        // the river into sky colour, which reads as milk rather than as water.
        uReflectivity: { value: settings.waterQuality === 'high' ? 0.72 : 0.55 },
        uOpacity: { value: 0.9 },
        uRain: { value: 0 },
        uDepthMap: { value: depthMap },
        uWorldSize: { value: WORLD_SIZE },
        uUnderwater: { value: 0 },
        // (BAND - ABOVE) / BAND is where the water line falls in the texture.
        uDepthZero: { value: (WATER_DEPTH_BAND - WATER_DEPTH_ABOVE) / WATER_DEPTH_BAND },
        uDepthBand: { value: WATER_DEPTH_BAND },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // The LOW preset swaps in a plain material: no per-pixel maths at all.
    this.simpleMaterial = new THREE.MeshLambertMaterial({
      color: 0x2f4f45,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(
      this.geometry,
      settings.waterQuality === 'low' ? this.simpleMaterial : this.material,
    );
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.name = 'water';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Update the shader's view of the world each frame. */
  update(
    time: number,
    cameraPos: THREE.Vector3,
    sunDirection: THREE.Vector3,
    skyColor: THREE.Color,
    zenithColor: THREE.Color,
    sunColor: THREE.Color,
    rain: number,
    waterLevel: number,
    underwater: boolean,
  ): void {
    this.mesh.position.y = waterLevel;
    if (this.mesh.material === this.simpleMaterial) return;
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uCameraPos.value.copy(cameraPos);
    u.uSunDirection.value.copy(sunDirection);
    u.uSkyColor.value.copy(skyColor);
    u.uZenithColor.value.copy(zenithColor);
    u.uSunColor.value.copy(sunColor);
    u.uRain.value = rain;
    u.uUnderwater.value = underwater ? 1 : 0;
  }

  setSettings(settings: GraphicsSettings): void {
    if (settings.waterQuality === this.quality) return;
    this.quality = settings.waterQuality;
    this.mesh.material = settings.waterQuality === 'low' ? this.simpleMaterial : this.material;
    this.material.uniforms.uWaveScale.value = settings.waterQuality === 'low' ? 0 : 1;
    this.material.uniforms.uReflectivity.value = settings.waterQuality === 'high' ? 0.72 : 0.55;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.simpleMaterial.dispose();
    this.depthTexture.dispose();
    this.mesh.removeFromParent();
  }
}

/**
 * Bake the terrain height into a texture the water shader can sample.
 *
 * Stored as "how far above the water line is the ground", normalised so 1 means
 * dry land and 0 means deep water.
 */
export function buildWaterDepthTexture(
  heightAt: (x: number, z: number) => number,
  resolution = 256,
): THREE.DataTexture {
  const data = new Uint8Array(resolution * resolution * 4);
  const half = WORLD_SIZE / 2;
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const x = -half + (i / (resolution - 1)) * WORLD_SIZE;
      const z = -half + (j / (resolution - 1)) * WORLD_SIZE;
      const h = heightAt(x, z);
      // Map [WATER_LEVEL - ABOVE, WATER_LEVEL - ABOVE + BAND] onto [0, 255].
      const normalised = (h - (WATER_LEVEL - WATER_DEPTH_ABOVE)) / WATER_DEPTH_BAND;
      const v = Math.max(0, Math.min(255, Math.round(normalised * 255)));
      const idx = (j * resolution + i) * 4;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      data[idx + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
