---
name: zack-d-films
description: Writes a 60-second, 3D-animated "what if" explainer video script (vertical short) with a scene-by-scene visual and narration table, production notes, and the real science behind it. Use when the user asks for a what-if video, short, or script, or runs /zack-d-films with a topic.
---

# What-if short script

Topic: $ARGUMENTS

If no topic was given, ask for one and stop.

## Output

Save the script to `scripts/<kebab-case-title>.md` and match the structure of `scripts/what-if-we-hit-another-universe.md`:

1. `# What If ...?` title, then one italic line: *Short-form "what if" script: 3D-animated explainer, vertical 9:16, about 60 seconds.*
2. A scene table `| # | Visual | Narration (VO) |` with 10–14 rows.
3. `## Production notes`: hook, pacing, sound, and how the loop works.
4. `## The real science behind it`: 3–6 bullets. End with a caveat bullet when the premise is speculative.

In chat, give the scene-by-scene beats in a short numbered list and the file path. Don't paste the whole file.

## Writing rules

- **Hook first:** scene 1 shows the most dramatic moment, with VO like "This is what would happen if…". No title card, no intro.
- **One idea per shot:** 1–2 short sentences of VO per scene, 4–6 seconds each, about 150 words of narration in total.
- **Plain words** a 12-year-old can follow. Follow one ordinary, original character through the scenario. Don't use characters, art or catchphrases from any existing channel.
- **Escalate:** setup → how it works → consequences → twist or real-world angle → payoff.
- **Loop:** the last scene cuts straight back into scene 1.
- **Accuracy:** simplify, but never state something false. Hedge speculative ideas ("some scientists think"). Check figures with WebSearch when you're unsure, and never invent numbers.
