// Launch-assets fixture index — brownfield demo content.
//
// IMPORTANT: This is brownfield *demo content*, not studio chrome. These
// components are the LeafMarker/Lerret launch graphics carried over from the
// original script-tag `studio/components/`. They exist so the migrated studio
// has something real to render on the canvas — exercising the canvas,
// pan/zoom viewport, focus mode, drag-reorder, inline rename, and html-to-image
// export with genuine artboard content.
//
// The real filesystem-driven project loader supersedes these fixtures with
// assets read from a real `.lerret/` folder on disk. They live under
// `src/fixtures/` (not `src/components/`) precisely because they are
// throwaway sample data, not part of the studio.
//
// This barrel re-exports every launch-asset component so `storyboard.jsx` can
// pull them from a single module.

export {
 LMLogo,
 LMPopup,
 LMTaskCard,
 FakeApp,
 BrowserShell,
} from './lm-ui.jsx';

export {
 LerretLockup,
 LerretCanvasMock,
 LerretFolderView,
 LerretCommand,
} from './lerret-ui.jsx';

export {
 PHHero,
 PHAnnotated,
 PHWorkflow,
 PHSnip,
 PHThreeUp,
 PHBrownfield,
} from './assets-ph.jsx';

export {
 LinkedInLaunch,
 SquareTagline,
 SquareKeyboard,
 RedditPost,
} from './assets-social.jsx';

export { OGImage, PHThumbnail, TwitterPost } from './assets-misc.jsx';

export {
 CWSPromoSmall,
 CWSPromoLarge,
 CWSPromoMarquee,
 CWSScreenshot,
 CWSScreenshot1,
 CWSScreenshot2,
 CWSScreenshot3,
 CWSScreenshot4,
 CWSScreenshot5,
 CWSScreenshotSnip,
} from './assets-chrome.jsx';

export { YTThumbA, YTThumbB, YTThumbC } from './assets-youtube.jsx';
