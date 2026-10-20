---
type: llm
focus: trace
weight: 2
---

Pass only if all hold, checked in the render_label calls and results in the trace:
- The final render_label input has an Icon object with a valid Material Icons name (the call did not fail with BAD_INPUT) and fontSize 32 or more.
- The text Ice cream (any case) appears on the label.
- The final render_label result has "warnings": [] (no warnings).
- The final reply gives the user the NiimBlue link.
