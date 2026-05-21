// Storyboard — the launch-assets canvas tree.
//
// (migration) This is the exact `<DesignCanvas>…</DesignCanvas>`
// tree that lived inline in the old `LeafMarker Launch Assets.html`'s `<App>`,
// lifted out verbatim into its own module. `main.jsx` mounts it inside
// `<StudioShell>`.
//
// Like everything under `src/fixtures/`, this is brownfield demo content — a
// real arrangement of artboards so the migrated canvas can be exercised. The
// real filesystem-driven loader supersedes this with a project read from disk.

import { DesignCanvas, DCSection, DCArtboard } from '../design-canvas.jsx';
import {
 PHHero,
 PHAnnotated,
 PHWorkflow,
 PHSnip,
 PHThreeUp,
 PHBrownfield,
 PHThumbnail,
 CWSPromoSmall,
 CWSPromoLarge,
 CWSPromoMarquee,
 CWSScreenshot1,
 CWSScreenshot2,
 CWSScreenshot3,
 CWSScreenshot4,
 CWSScreenshot5,
 CWSScreenshotSnip,
 LinkedInLaunch,
 OGImage,
 TwitterPost,
 RedditPost,
 YTThumbA,
 YTThumbB,
 YTThumbC,
 SquareTagline,
 SquareKeyboard,
} from './launch-assets/index.jsx';

export const storyboard = (
 <DesignCanvas
 title="Lerret — Launch Assets"
 subtitle="Ordered by launch priority. Top sections drive installs; bottom sections are optional variety."
 >
 {/* ===== MUST-HAVE — drives installs / required for launch ===== */}

 <DCSection
 id="ph-gallery"
 title="Product Hunt — Gallery (1270×760) · MUST-HAVE — first thing seen on PH"
 >
 <DCArtboard id="ph-hero" label="01 · Hero — tagline + canvas mock" width={1270} height={760}>
 <PHHero />
 </DCArtboard>
 <DCArtboard id="ph-annotated" label="02 · Step 1 — pick a folder" width={1270} height={760}>
 <PHAnnotated />
 </DCArtboard>
 <DCArtboard id="ph-workflow" label="03 · Step 2 — design on the canvas" width={1270} height={760}>
 <PHWorkflow />
 </DCArtboard>
 <DCArtboard id="ph-snip" label="04 · The .lerret file (plain JSON)" width={1270} height={760}>
 <PHSnip />
 </DCArtboard>
 <DCArtboard id="ph-threeup" label="05 · The loop — design / export / post" width={1270} height={760}>
 <PHThreeUp />
 </DCArtboard>
 <DCArtboard id="ph-brownfield" label="06 · Templates that fork" width={1270} height={760}>
 <PHBrownfield />
 </DCArtboard>
 </DCSection>

 <DCSection id="thumb" title="Product Hunt thumbnail (240×240) · REQUIRED — PH listing field">
 <DCArtboard
 id="ph-thumb"
 label="PH thumbnail / app icon"
 width={240}
 height={240}
 style={{ background: 'transparent', boxShadow: 'none' }}
 >
 <PHThumbnail />
 </DCArtboard>
 </DCSection>

 <DCSection
 id="chrome"
 title="App showcase — promo tiles + 1280×800 screenshots · Marketplace listing or website hero"
 >
 <DCArtboard id="cws-promo-small" label="Promo tile — small (440×280)" width={440} height={280}>
 <CWSPromoSmall />
 </DCArtboard>
 <DCArtboard id="cws-promo-large" label="Promo tile — large (920×680)" width={920} height={680}>
 <CWSPromoLarge />
 </DCArtboard>
 <DCArtboard id="cws-promo-marquee" label="Promo tile — marquee (1400×560)" width={1400} height={560}>
 <CWSPromoMarquee />
 </DCArtboard>
 <DCArtboard id="cws-screenshot-1" label="Screenshot 1 — Pick a folder (1280×800)" width={1280} height={800}>
 <CWSScreenshot1 />
 </DCArtboard>
 <DCArtboard id="cws-screenshot-2" label="Screenshot 2 — Design on the canvas (1280×800)" width={1280} height={800}>
 <CWSScreenshot2 />
 </DCArtboard>
 <DCArtboard id="cws-screenshot-3" label="Screenshot 3 — Export to your folder (1280×800)" width={1280} height={800}>
 <CWSScreenshot3 />
 </DCArtboard>
 <DCArtboard id="cws-screenshot-4" label="Screenshot 4 — Plain JSON file (1280×800)" width={1280} height={800}>
 <CWSScreenshot4 />
 </DCArtboard>
 <DCArtboard id="cws-screenshot-5" label="Screenshot 5 — Preset frames (1280×800)" width={1280} height={800}>
 <CWSScreenshot5 />
 </DCArtboard>
 <DCArtboard id="cws-screenshot-snip" label="Screenshot 6 — Templates that fork (alt)" width={1280} height={800}>
 <CWSScreenshotSnip />
 </DCArtboard>
 </DCSection>

 {/* ===== SHOULD-HAVE — launch tweet, LinkedIn post, URL share previews ===== */}

 <DCSection
 id="linkedin"
 title="LinkedIn portrait (1080×1350) + Open Graph (1200×630) · SHOULD-HAVE — URL share previews"
 >
 <DCArtboard id="li-launch" label="LinkedIn — portrait (1080×1350)" width={1080} height={1350}>
 <LinkedInLaunch />
 </DCArtboard>
 <DCArtboard id="og" label="Open Graph / og:image (1200×630)" width={1200} height={630}>
 <OGImage />
 </DCArtboard>
 </DCSection>

 <DCSection id="wide" title="Twitter / X (1600×900) · SHOULD-HAVE — for the launch tweet">
 <DCArtboard id="tw" label="Twitter — light hero" width={1600} height={900}>
 <TwitterPost />
 </DCArtboard>
 </DCSection>

 <DCSection id="reddit" title="Reddit (1200×675) · SHOULD-HAVE — for r/SideProject and dev/design subs">
 <DCArtboard id="reddit-post" label="Reddit — casual hero" width={1200} height={675}>
 <RedditPost />
 </DCArtboard>
 </DCSection>

 <DCSection id="youtube" title="YouTube thumbnail (1280×720) · SHOULD-HAVE — pick one for the demo video">
 <DCArtboard id="yt-thumb-a" label="YT Thumbnail A — light typographic (60s tour)" width={1280} height={720}>
 <YTThumbA />
 </DCArtboard>
 <DCArtboard id="yt-thumb-b" label="YT Thumbnail B — dark, blank → launch in 90s" width={1280} height={720}>
 <YTThumbB />
 </DCArtboard>
 <DCArtboard id="yt-thumb-c" label="YT Thumbnail C — plain JSON / design as code" width={1280} height={720}>
 <YTThumbC />
 </DCArtboard>
 </DCSection>

 {/* ===== OPTIONAL — Instagram / extra variety ===== */}

 <DCSection id="square" title="Square posts (1080×1080) · OPTIONAL — Instagram + ad variety">
 <DCArtboard id="sq-tagline" label="Square — dark tagline" width={1080} height={1080}>
 <SquareTagline />
 </DCArtboard>
 <DCArtboard id="sq-keyboard" label="Square — keyboard hero (⌘E)" width={1080} height={1080}>
 <SquareKeyboard />
 </DCArtboard>
 </DCSection>
 </DesignCanvas>
);
