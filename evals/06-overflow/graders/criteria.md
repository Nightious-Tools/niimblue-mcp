---
type: llm
focus: trace
weight: 2
---

Pass only if all hold, checked in the render_label calls and results in the trace:
- Either the final render's head side (the side across the printhead) is 96 px or less (for example the label was resized to 12 mm across the head), or the agent explains to the user that the D110 head is 12 mm and 14 mm will not fit.
- If a HEAD_OVERFLOW warning appeared, the agent acted on it or told the user about it; it was not silently ignored.
- PANTRY appears on the label.
- The final reply gives the user the NiimBlue link.
