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
4. Drag a card at least 80 CSS pixels right and release. It must immediately
   leave stock and appear in shopping with the same quantity, unit and category.
   No click or confirmation is required.
5. Drag an expired card left past the same threshold and release: it must be
   deleted without a click or confirmation. A short/canceled swipe does nothing.
6. Repeat after switching to household and medicine. Check both narrow and wide
   viewports, including a card whose entrance animation has already completed.
7. Inspect computed style: the card must have `animation-name: none`; during
   dragging the transform matrix must match the inline transform. Editing
   remains available via the three-dot menu.
8. On an actual iPhone, additionally check vertical scrolling with inertia,
   slight diagonal swipes, canceled gestures and the three-dot menu.

The fixture serves the actual production build with disposable, in-memory API
data, binds only to loopback, and does not use the production database.
Use `node scripts/serve-swipe-fixture.mjs --fail-move-once` to check that a failed
move restores the card and displays an error. The next swipe should succeed.

Browser verification confirmed automatic transfer, the unchanged quantity in
shopping, immediate deletion, and card restoration/retry on a simulated error.
Physical iPhone verification still requires the device.

## Automated checks

`npm test -- --watch=false` exercises native touch events dispatched on rendered
cards: products, household and medicine, expired items, vertical direction lock,
duplicate touch pointer cancellation, short gestures, cancellation, multitouch
and menu buttons, no confirmations, duplicate releases, failed requests/retry
and stale refresh responses. These DOM tests do not replace the browser CSS check.

`npm run test:server` additionally verifies transfers for all three categories,
duplicate request rejection and rollback of the shopping insert if stock deletion
fails, using a disposable SQLite database.
