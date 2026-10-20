---
type: llm
focus: trace
weight: 2
---

Pass only if all hold, checked in the render_label calls and results in the trace:
- The final render_label call does not fail with BAD_INPUT, and its result has "warnings": [] (no warnings).
- The final label carries the SKU in a code: either a Barcode whose text leaves out the $ (or the whole SKU is shown as text next to it), or a QRCode holding the full AB-100$X.
- The final reply tells the user why the $ was avoided in the barcode (NiimBlue's Code 128 encodes $ wrongly, so it would not scan).
- The final reply gives the user the NiimBlue link.
