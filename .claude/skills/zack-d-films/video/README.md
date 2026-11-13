# zack-d-films video engine

This engine turns a `scenes.mjs` file into a vertical MP4 with these stages:

- **Pictures:** Three.js scenes rendered in headless Chromium.
- **Voice:** Kokoro neural text-to-speech.
- **Sound:** procedural sound effects and a drone bed.
- **Captions:** word-by-word captions in the style of short-form videos.
- **Encoding:** ffmpeg.

`setup.sh` installs everything into `~/.cache/zack-d-films` the first time it runs, about 120 MB, mostly the voice model downloaded from GitHub releases.

```
make.sh <dir> --stills [--at 0.5]   # one frame per scene + build/contact.jpg
make.sh <dir> [--fps 30 --w 720 --h 1280]   # full render -> <dir>/<dir-name>.mp4
make.sh <dir> --audio               # rebuild voice/music/sfx only and re-mux (after a full render)
```

## scenes.mjs

```js
export default {
  voice: 'am_michael',   // Kokoro voices: am_michael, am_adam, am_puck, af_heart, af_bella, bf_emma, ...
  speed: 1.08,
  music: { style: 'space', volume: 0.16 },  // generated background music, ducked under the voice: space | tense | chill | epic (null = none)
  drone: 0.07,           // low ambient hum, used only when there's no music
  captions: { perGroup: 3, y: 0.7, size: 64 },   // or false
  scenes: [
    {
      vo: 'Narration for this shot.',   // scene length = voice length + hold (default 0.3s)
      sfx: ['whoosh', { type: 'boom', at: 2.4, gain: 0.7 }],  // whoosh boom hit crack glitch riser ding pop heartbeat
      silence: false,     // true drops the music/drone out during this scene (dramatic beat)
      duration: 0,        // fixed length in seconds (use for scenes with no VO)
      captions: undefined,// per-scene override, false hides
      build(ctx) {        // runs once when the scene starts; build the 3D set here
        const { THREE, scene, camera, lib, fx, W, H, duration } = ctx;
        // ...create objects...
        return (t, p) => { /* every frame: t = seconds into scene, p = 0..1 */ };
      },
    },
  ],
};
```

Rules:

- **Pure update functions:** `update` should set everything from `t`. Frames are rendered in order, but stills jump around.
- **Fresh scene each time:** every scene starts with a new `THREE.Scene` and camera (fov 50, portrait 9:16), so share sets through plain helper functions in the file.
- **Portrait framing:** only about ±15° is visible horizontally, so stack things vertically rather than side by side.

## ctx.fx (2D post effects, reset every frame except vignette/crack position)

| Field | Effect |
| :- | :- |
| `flash` | White flash (0..1) |
| `fade` | Fade to black (0..1) |
| `tint` + `tintAmount` | Color overlay, e.g. `fx.tint = '#ff6a00'; fx.tintAmount = 0.15` |
| `glitch` | Glitch strips (0..1) |
| `crack` | Cracked-glass overlay growing from `crackX`, `crackY` (0..1), with `crackSeed` |
| `xray` | Inverted, X-ray-style image (0..1) |
| `vignette` | Edge darkening (default 0.45) |
| `title` | Big text, with `titleColor`, `titleY` (0..1) and `titleSize` (px) |

## ctx.lib helpers

| Group | Helpers |
| :- | :- |
| Math | `clamp lerp ease easeIn easeOut range(t,a,b) easeRange(t,a,b) rng(seed)` |
| Environments | `sky(scene,{top,bottom,sunColor,sunIntensity,ambient,fogNear,fogFar})` returns `{setColors}` · `space(scene,{stars,background})` · `starfield(scene,{count})` for night skies · `ground(scene,{color,size})` |
| People | `person({skin,shirt,pants,hair})` returns a group with `.parts` (head torso armL armR legL legR mouth); arms and legs pivot at shoulder/hip, and negative `rotation.x` swings them forward. Animate with `idle(p,t) walk(p,t) wave(p,t) mouth(p,0..1)` |
| Props | `bowl() tree({height}) house({color,roof}) city(scene,{count,radius,night})` |
| Space | `planet({kind:'earth'\|'moon'\|'mars'\|'gas'\|'ice'\|'lava',radius})` · `star({radius,color})` · `galaxy({radius,count,size\|pixelSize,color,core})` · `galaxyCollision({count,scale})` with `.update(s)`, `.starPos(i,s)`, `.coreA/.coreB` · `bubble({radius,color})` · `fresnelSphere(r,color)` |
| Effects | `particles(n,{color,size,spread,shape:'box'\|'ball'\|'disc'})` returns `{points, base, pos, update()}` · `glow(color,size)` · `label(text,{height,bg,color})` · `wall({width,height,color,additive,strength})` with `.setTime(t)` |
| Camera | `orbit(camera,{target,radius,angle,height})` · `shake(camera,amount,t)` (call after positioning) |
| Materials | `mat(color,opts)` (standard) · `glowMat(color)` (unlit) |

For anything else, write Three.js directly. `THREE` is in ctx, and addons are importable from `three/addons/...`.
