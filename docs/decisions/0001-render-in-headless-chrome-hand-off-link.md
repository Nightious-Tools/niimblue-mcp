---
title: Render in headless Chrome and hand off printing as a NiimBlue link
status: accepted
---

## Context

An agent that designs NIIMBOT labels needs to see what the printer will print. It also needs a way to
get the label onto the printer. NiimBlue's preview is fabric.js running in a browser, and its
printer link uses Web Bluetooth or Web Serial.

## Decision

`render_label` runs NiimBlue's own page code, pinned to a sha, in the system Chrome or Edge over
`--remote-debugging-pipe`. It returns the threshold-140 1-bit PNG plus a `#load=` link that opens the
label in NiimBlue. The server never talks to a printer.

## Rationale

Running the app's own code is the only way to get the exact print preview. A Node re-implementation
would drift from it. The link makes NiimBlue the one place that prints, and it ships no runtime
npm dependencies.

## Consequences

- Every render needs Chrome or Edge installed. Without one it returns `CHROME_NOT_FOUND`, which is
  common in cloud containers.
- Each render cold-starts Chrome, about 0.5–1 s.
- `--no-sandbox` is on only because the page loads nothing external. Revisit it before allowing
  images or URLs.
- A NiimBlue sha bump means re-pinning six packages and rerunning the parity check.
