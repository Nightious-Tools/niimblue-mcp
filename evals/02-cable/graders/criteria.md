---
type: llm
focus: trace
weight: 2
---

Pass only if all hold, checked in the render_label calls and results in the trace:
- The final render_label input uses printer D110, tail_length_mm greater than 0 and mirror "copy" (so both ends of the flag carry the text).
- The text identifies the NAS power cable.
- The final render_label result has "warnings": [] (no warnings).
- The final reply gives the user the NiimBlue link.
