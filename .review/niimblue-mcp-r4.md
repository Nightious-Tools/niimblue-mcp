What this change does: It changes only `skills/niimblue/SKILL.md`. On 12 mm tape, a label is now one hero word at 56–64 px, with an optional icon or inverse block beside it, and never a second line. The folder-tab and cable-flag recipes now follow that rule. Round 3's two fixes still hold: the QR far-edge check is at `src/page/render.ts:92` and is tested with widths 63 and 105 at `test/render.test.ts:57`, and `URL.canParse` is at `src/config.ts:13` with its test at `test/config.test.ts:7`.

Checked: `CI=true npm test` passes 61 of 61. The 12 mm recipes render through `dist/index.mjs` with no warnings, and their boxes stay inside the label. I also rendered the cable-flag recipe with other words in place of "WAN". Assumed load: one person and one agent.

**Must fix:**

1. **On the cable flag, the new rule pushes any word longer than 4 letters across the fold, with no warning** (`skills/niimblue/SKILL.md:40`, `:94-100`)
   - **What this is:** A cable-flag face is 30 mm, which is 240 px. The recipe gives the word a 152 px column (`left` 76) beside the 64 px icon block. The new line 40 allows only 56–64 px and never a second line. Line 74 says "Change the words, keep the geometry".
   - **Problem:** I rendered the recipe with only the word changed. "ROUTER" at 56 px gives a box 226 px wide (x 76–302), which runs 62 px past the face edge at 240 and onto the mirrored second face. "POWER" gives 204 px. With `scaleX` 0.8, "ROUTER" is 181 px and "SWITCH" is 178 px. Every one of these returns `warnings: []`, because the page has no check for split faces. So an agent that follows the rule either breaks it or prints across the fold. "ROUTER" is the word the old recipe used, at 36 px.
   - **Fix:** One clause on line 40, after "never a second line": `; a longer word gets scaleX 0.8, then drops to 44 (on a split face, keep its box inside the face)`. No code change.
   - **If we skip it:** A router or switch cable flag prints with the name cut by the fold, and the tool reports it clean. Eval 02 uses "NAS" (153 px, which fits), so it would not catch this.

Verdict: fix 1 first.
Not checked: I did not re-run eval `02-cable` after the recipe change (the implementer also flagged this), and I did not do a live NiimBlue preview of the new recipes. The root cause, that no warning fires when an object crosses a split face, is in `src/page/render.ts` from before this change, so it is not a finding here.
