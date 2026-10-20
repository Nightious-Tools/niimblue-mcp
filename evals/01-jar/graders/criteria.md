---
type: llm
focus: trace
weight: 2
---

Pass only if all hold, checked in the render_label calls and results in the trace:
- The final render_label input uses printer B1 and a label about 50×30 mm.
- A Textbox text contains a {dt…} date field (for example {dt|DD.MM.YYYY}).
- The final render_label result has "warnings": [] (no warnings).
- The final label's head side (the width_px or height_px that runs across the printhead) is 384 px or less.
- FLOUR (any case) is the largest text on the label, and the label uses at most 3 distinct fontSize values.
- The final reply gives the user the NiimBlue link.
