# Card swipe regression

## Root cause

The `card-in` entrance animation used `animation-fill-mode: both` on the same
`.fridge-row` element whose inline `transform` was updated by the gesture.
Its final keyframe (`translateY(0)`) continued to override that transform after
the entrance finished. Changing event handlers could not fix this CSS conflict.

Observed on the published app, after dragging a card left:

- Inline transform: `translate3d(-108px, 8.64px, 0px) rotate(-2.7deg)`.
- Computed transform: `matrix(1, 0, 0, 1, 0, 0)`.
- Animation: `0.18s ease-out both card-in`.

Entrance motion now belongs to `.fridge-swipe-shell`. The gesture element has no
animation and owns its transform. Native vertical scrolling uses `pan-y`;
there is no programmatic `window.scrollBy` replacement. Touch pointer events
cannot prematurely finish the independent touch gesture.

## Repeatable browser check

1. Run `npm run build`.
2. Run `node scripts/serve-swipe-fixture.mjs`.
3. Open `http://127.0.0.1:4318/` and skip onboarding.
4. Drag a card right, then tap the exposed pencil: the quantity menu must open.
5. Close the menu and drag an expired card left: the red delete action must be
   exposed; the item must remain until deletion is explicitly confirmed.
6. Repeat after switching to household and medicine. Check both narrow and wide
   viewports, including a card whose entrance animation has already completed.
7. Inspect computed style: the card must have `animation-name: none`; after
   release the transform matrix must contain an X translation of approximately
   `108` or `-108`, matching the inline transform.
8. On an actual iPhone, additionally check vertical scrolling with inertia,
   slight diagonal swipes, canceled gestures and the three-dot menu.

The fixture serves the actual production build with synthetic, read-only API
responses, binds only to loopback, and does not use the production database.

Browser verification during this fix confirmed left/right computed translations
of approximately -108/+108, the visible red/green actions and the quantity menu.
Physical iPhone verification still requires the device.

## Automated checks

`npm test -- --watch=false` exercises native touch events dispatched on rendered
cards: products, household and medicine, expired items, vertical direction lock,
duplicate touch pointer cancellation, short gestures, cancellation, multitouch
and menu buttons. These DOM tests do not replace the browser CSS check above.
