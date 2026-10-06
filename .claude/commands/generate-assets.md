---
description: Fulfil open AI image/video asset requests with native generation
argument-hint: "<project id> [request ids]"
---

Fulfil Motion Studio asset requests for $ARGUMENTS.

1. `npm run studio -- requests <project> --status requested` (or use the ids given).
2. For each request:
   - `npm run studio -- assets:generating <request_id>`.
   - Read the prompt, aspect ratio, style notes, purpose, feedback from previous attempts, and `.project/brand.md` (image style).
   - Generate the image/video with your native generation capability at the requested aspect ratio. Save the file(s) to a temporary folder.
   - `npm run studio -- assets:fulfill <request_id> <file> [file…]`.
   - If generation is not possible, `npm run studio -- assets:fail <request_id> --reason "…"`.
3. Do not approve candidates or place them in scenes unless the user asks — approval happens in the GUI (Assets → Images/Videos).
4. Summarize which requests now have candidates ready for review.
