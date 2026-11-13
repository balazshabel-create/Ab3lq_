---
name: zack-d-films
description: Makes a 60–75 second, 3D-animated "what if" explainer video (vertical 9:16 MP4 with AI voice-over, captions and sound effects) from a topic, plus its script. Use when the user runs /zack-d-films with a topic or asks for a what-if video or short.
---

# What-if video

Topic: $ARGUMENTS

If no topic was given, ask for one and stop. Otherwise make the whole video without asking for confirmation.

## 1. Script → `scripts/<slug>.md`

Match `scripts/what-if-we-hit-another-galaxy.md`: a title, an italic format line, a scene table `| # | Visual | Narration (VO) |` with 10–14 rows, production notes, and "The real science behind it" (3–6 bullets, with a caveat where it's speculative).

- **Hook first:** scene 1 shows the most dramatic moment, with VO like "This is what would happen if…". No intro.
- **One idea per scene,** 1–2 short sentences of VO, about 150–190 words in total. Use plain words a 12-year-old can follow.
- **Escalate:** setup → how it works → consequences → twist or real-world angle → payoff. The last scene is a short silent loop back into scene 1.
- **Original characters only.** Don't use characters, art or catchphrases from any existing channel.
- **Accuracy:** never state something false. Check facts and numbers with WebSearch, hedge anything uncertain, and never invent figures. Write numbers out as words in the VO ("thirty kilometers") so the voice reads them correctly.

## 2. Scenes → `videos/<slug>/scenes.mjs`

Use the narrator `voice: 'am_michael:0.5,am_fenrir:0.3,am_puck:0.2', speed: 1.15` (the user's chosen voice: American male, a bit deep, calm but excited) unless they ask for another. Set `music` to the style that fits the topic (space, tense, chill or epic) at volume 0.14–0.18, so it stays low under the voice. Turn each script row into one scene, following `${CLAUDE_SKILL_DIR}/video/README.md` (scene format and helper API). Use `videos/what-if-we-hit-another-galaxy/scenes.mjs` as a worked example: a reusable porch set, a night sky, a galaxy collision simulation, and labels and titles.

## 3. Preview and fix

Run `bash ${CLAUDE_SKILL_DIR}/video/make.sh videos/<slug> --stills` (about 1–2 minutes). Read `videos/<slug>/build/contact.jpg`; rerun with `--at 0.9` to check scene endings. Check that each scene's subject is in frame (portrait is narrow), visible and not washed out, and that labels aren't cut off. Fix and repeat until every scene reads clearly. To recheck after changing visuals only, run `node ${CLAUDE_SKILL_DIR}/video/render.mjs stills videos/<slug>`, which skips the audio step.

## 4. Render and deliver

Run `bash ${CLAUDE_SKILL_DIR}/video/make.sh videos/<slug>` in the background. It takes roughly 5–10 minutes for 70 seconds and writes `videos/<slug>/<slug>.mp4`. When the render finishes, send the MP4 with SendUserFile (`display: "render"`), plus a short list of the scene beats and one line on sources. To change only the voice, music or sound effects later, run `make.sh videos/<slug> --audio` (about 1 minute) instead of a full render.
