---
type: llm
focus: trace
weight: 2
---

Pass only if all hold, checked in the render_label calls and results in the trace:
- The final render_label input has a QRCode object whose text is exactly https://inv.example.com/a/LT-0042.
- The QR module size is at least 3 px (the result or the skill's sizing; no QR_MODULE_SMALL warning).
- The final render_label result has no warning whose code starts with QR_, and no other warnings.
- LT-0042 also appears as readable text.
- The final reply gives the user the NiimBlue link.
