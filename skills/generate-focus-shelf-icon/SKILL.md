---
name: generate-focus-shelf-icon
description: Generate a safe, large, flat 2D vector topic icon for a Focus Shelf parent ticket from its verified title and brief task context. Use during an authorized Focus Shelf catalog refresh; do not use for screenshots, logos, status claims, or arbitrary SVG markup.
---

# Generate Focus Shelf Icon

Create one distinctive topic illustration for each visible parent ticket or shared-topic family. Base the metaphor on the verified parent title and a short sanitized task summary. Prefer one concrete object or action over generic ticket, checkmark, warning, or company-logo imagery. Reuse an existing generated icon while the ticket meaning is unchanged; dynamic generation must not make the same ticket randomly change on every refresh.

Return only the validated icon object placed in `presentation.tickets[].icon`:

```json
{"version":1,"paths":[{"d":"M10 12H54V42H28L16 52V42H10Z","role":"fill"},{"d":"M10 12H54V42H28L16 52V42H10Z","role":"stroke"}]}
```

The application supplies a fixed `0 0 64 64` viewBox and the ticket tone. Use 1–12 SVG paths. Each path has only `d`, `role`, and optional `strokeWidth` from 1–6. Roles are `stroke`, `fill`, `accent`, or `inverse`. Path data may contain only SVG path commands and numbers; no text, transforms, CSS, URLs, XML, HTML, scripts, event handlers or embedded images.

Make the main subject occupy roughly coordinates 8–56 in both axes so it remains recognizable at 42–46 px. Use a simple filled silhouette plus two or three clear outline/details where helpful. Avoid tiny decoration, thin strokes, photorealism and visual noise. Do not encode completion, approval, incident severity or deployment state unless that concept is literally the verified ticket subject.

The Focus Shelf catalog writer is the final validator. If the generated object fails validation, simplify its paths; never bypass validation or fall back to Emoji. Use the neutral built-in `ticket` icon only when the available title/context does not support an honest topic metaphor.
