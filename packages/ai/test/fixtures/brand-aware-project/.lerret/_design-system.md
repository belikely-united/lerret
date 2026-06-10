# Design System — Lerret (dogfood fixture)

The canonical brand authority for this project. The AI reads this FIRST when
resolving any brand-token reference ("our orange", "the brand font"). Values
here WIN over `config.json` `vars`.

## Brand tokens

```lerret-tokens
colors:
  brand: "#B85B33"
  accent: "#F1EDE5"
  neutralDark: "#1A1714"
fonts:
  display: "Geist"
  body: "Geist"
```

## Voice rules

- Calm, factual, builder-to-builder. No hype, no exclamation marks.
- Lowercase product nouns; never shout the brand name.
- Default to specifics over adjectives.

<!-- scope: social-media/ -->

## Social-media overrides

For anything under `social-media/`, tighten the voice further:

- One idea per post. Lead with the verb.
- Hashtags are off unless explicitly asked.
- The brand orange `#B85B33` carries the post — let it breathe; do not crowd it
  with secondary colors.

<!-- scope: social-media/twitter/ -->

## Twitter-only overrides

Closer scope wins: for anything under `social-media/twitter/` these rules
REPLACE the broader social-media section above.

- Tweet copy stays under 200 characters end-to-end.
