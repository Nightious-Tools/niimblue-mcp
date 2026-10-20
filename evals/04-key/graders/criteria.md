---
type: llm
focus: trace
weight: 2
---

Pass only if all hold, checked in the render_label calls and results in the trace:
- The final render_label input uses printer D11.
- One hero word (for example GARAGE or KEY) has fontSize 56 or more, and it is the largest text.
- The final render_label result has "warnings": [] (no warnings).
- The final reply gives the user the NiimBlue link.
