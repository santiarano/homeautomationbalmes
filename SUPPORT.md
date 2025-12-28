# StandByMe Dashboard - Support Documentation

## Footer Carousel with Volume Control Slider

### Overview
The footer carousel allows users to swipe horizontally on the media player footer to access a large volume control. This feature was implemented to make volume adjustment easier on the StandByMe device's touch interface.

### Implementation Details

#### HTML Structure
The footer is wrapped in a carousel structure with two pages:
- **Page 1**: Normal footer with album art, track info, playback controls, and small volume slider
- **Page 2**: Large volume control with oversized slider for easy operation

```html
<div class="footer-carousel" id="footer-carousel">
    <div class="footer-track" id="footer-track">
        <div class="footer-page footer-page-main">
            <!-- Normal footer content -->
        </div>
        <div class="footer-page footer-page-volume">
            <!-- Large volume control -->
        </div>
    </div>
    <div class="footer-dots" id="footer-dots">
        <!-- Pagination dots -->
    </div>
</div>
```

#### CSS Implementation
Key CSS properties for the carousel:

1. **Footer Track**:
   - `display: flex` - Enables horizontal layout
   - `overflow-x: auto` - Allows horizontal scrolling
   - `scroll-snap-type: x mandatory` - Enables page snapping
   - `touch-action: pan-x` - Allows horizontal pan gestures (critical for webOS)

2. **Footer Pages**:
   - `min-width: 100%` - Each page takes full viewport width
   - `scroll-snap-align: start` - Snaps to start of each page

3. **Body Touch Action**:
   - Changed from `touch-action: manipulation` to `touch-action: pan-x pan-y`
   - This was **critical** - `manipulation` blocks pan gestures needed for scrolling

#### JavaScript Implementation

**Custom Drag Scroll Function** (`enableDragScroll`):
- Uses **Pointer Events** API (not Touch Events) for better webOS compatibility
- Implements capture phase event listeners (`addEventListener(..., true)`)
- Uses `setPointerCapture` and `releasePointerCapture` for robust drag handling
- Implements page snapping when `snapToPages: true`
- Includes `ignoreSelector` option to prevent slider drag from scrolling the carousel

**Key Features**:
- Horizontal drag-to-scroll with momentum
- Automatic page snapping on release
- Pagination dots update automatically
- Slider interaction doesn't interfere with carousel scrolling

### Problems Encountered and Solutions

#### Problem 1: Scrolling Not Working on webOS
**Issue**: Native `overflow: scroll` with touch gestures is unreliable on webOS devices.

**Root Cause**: 
- webOS has inconsistent support for native touch scrolling
- The body had `touch-action: manipulation` which blocks pan gestures

**Solution**:
1. Changed body `touch-action` from `manipulation` to `pan-x pan-y`
2. Implemented custom JavaScript drag scroll using Pointer Events API
3. Used capture phase event listeners to ensure events are captured even if child elements handle them

#### Problem 2: Slider Drag Scrolling the Carousel
**Issue**: When dragging the volume slider, it would inadvertently scroll the carousel instead of adjusting volume.

**Root Cause**: The drag scroll handler was capturing all pointer events, including those on the slider input.

**Solution**:
- Added `ignoreSelector: 'input[type="range"]'` option to `enableDragScroll`
- The handler checks if the event target is within an ignored element and returns early
- This allows the slider to function normally while still enabling carousel scrolling elsewhere

#### Problem 3: Events Not Being Captured
**Issue**: Pointer events weren't being captured reliably, especially when starting drag on interactive elements.

**Root Cause**: Event listeners were attached in bubble phase, so child elements could prevent propagation.

**Solution**:
- Changed to capture phase listeners: `addEventListener('pointerdown', handler, true)`
- This ensures events are captured before child elements can handle them
- Used `stopPropagation()` in the handler to prevent event bubbling

#### Problem 4: Page Snapping Not Working
**Issue**: After dragging, the carousel wouldn't snap to the nearest page.

**Root Cause**: The snap calculation was using `scrollLeft` which might not be accurate immediately after drag.

**Solution**:
- Implemented snap calculation in the `pointerup` handler
- Calculates current page index: `Math.round(scrollPos / pageWidth)`
- Uses `scrollTo()` with `behavior: 'smooth'` for animated snapping
- Updates pagination dots via `onIndexChange` callback

### Technical Notes

#### Why Pointer Events Instead of Touch Events?
- Pointer Events API is more reliable on webOS
- Provides unified handling for mouse, touch, and pen input
- Better support for `setPointerCapture` which ensures drag continues even if pointer moves outside element
- More consistent across different webOS versions

#### Why Capture Phase?
- Ensures events are captured before child elements can prevent them
- Critical for elements with nested interactive children (buttons, sliders, etc.)
- Allows the carousel to handle drag gestures even when starting on a button or control

#### Performance Considerations
- Event handlers are attached once per carousel (not per element)
- Uses `dataset.dragScrollAttached` flag to prevent duplicate handlers
- Minimal DOM queries (caches element references)
- Smooth scrolling uses native `scrollTo()` with CSS `scroll-behavior: smooth`

### Usage

#### Initialization
The footer carousel is initialized in `DOMContentLoaded`:
```javascript
setTimeout(() => {
    initFooterCarousel();
}, 100);
```

The small delay ensures the DOM is fully ready.

#### Adding More Pages
To add additional pages:
1. Add a new `.footer-page` div inside `.footer-track`
2. Add a corresponding dot in `.footer-dots`
3. The carousel will automatically handle the new page

#### Customization
- **Snap sensitivity**: Adjust `Math.round(scrollPos / pageWidth)` calculation
- **Scroll speed**: Modify the `walk` multiplier in `pMove` handler (currently `1.5`)
- **Animation**: Change `behavior: 'smooth'` to `'auto'` for instant snapping

### Files Modified
- `webos-app/index.html` - Added carousel HTML structure
- `webos-app/styles.css` - Added carousel and large volume styles
- `webos-app/app.js` - Added `enableDragScroll()` and `initFooterCarousel()` functions

### Testing Checklist
- [x] Horizontal swipe scrolls between pages
- [x] Page snapping works on release
- [x] Pagination dots update correctly
- [x] Dots are clickable to jump to pages
- [x] Volume slider works without scrolling carousel
- [x] Works on webOS StandByMe device
- [x] Compact layout (50% reduced height)
- [x] Speaker name removed for space

### Future Improvements
- Add swipe indicators (arrows or hints)
- Add haptic feedback on page change (if webOS API supports it)
- Consider adding more pages (e.g., equalizer, queue management)
- Add keyboard navigation support for accessibility

---

## Actions Carousel (Circle Buttons) - Clipping Fix

### Problem: Button Blur Effects Being Clipped

The circle buttons have `::before` pseudo-elements with `filter: blur(8px)` that extend 18px beyond the button boundaries (`inset: -18px`). These blur effects were being clipped at the top and bottom of the carousel.

### Root Cause Analysis

1. **Browser Overflow Behavior**: When an element has `overflow-x: auto`, browsers automatically force `overflow-y: auto` (or `hidden`), even if you explicitly set `overflow-y: visible`. This is a browser security/performance feature that cannot be overridden with CSS alone.

2. **Multiple Clipping Layers**: The clipping was happening at multiple levels:
   - `.container` had `overflow-y: auto` which clipped content extending beyond viewport
   - `.actions-track-wrapper` had `overflow-x: auto` which forced `overflow-y: auto`, clipping the blur effects
   - The wrapper's bounding box was positioned such that the blur extended outside its boundaries

3. **Blur Extension**: The buttons' blur effects extend 18px above and below the button. If a button is at `top: 60px`, the blur needs to be visible from `42px` to `78px` (60 - 18 to 60 + 18 + button height).

### Solution

The fix involved a multi-layered approach:

#### 1. Container Overflow Fix
```css
.container {
    overflow-y: visible; /* Changed from 'auto' */
}
```
This prevents the container from clipping content that extends beyond the viewport.

#### 2. Wrapper Padding and Negative Margin
```css
.actions-track-wrapper {
    padding: 57px 0 30px 0;
    margin: -67px 0 -30px 0;
    min-height: calc(100% + 87px);
}
```

**How it works:**
- **Padding (57px top)**: Creates internal space within the wrapper's bounding box for the blur to exist
- **Negative margin (-67px top)**: Moves the wrapper's bounding box UP by 67px, so it starts above where the blur needs to be
- **Result**: The wrapper's bounding box starts at a negative position, and the blur (which extends 18px above buttons) fits within the padded area

#### 3. Carousel Positioning
```css
.actions-carousel {
    margin: -10px 0 0 0;
    padding: 40px 0 0 0;
}
```
Adjusts the carousel position to work with the wrapper's negative margin.

#### 4. Specific Rule for Top Divider
```css
.divider + .actions-carousel .actions-track-wrapper {
    padding-top: 57px;
    margin-top: -67px;
}
```
Ensures the top divider case has the same treatment as the general case.

### Key Insight

The critical insight is that **padding creates space INSIDE an element's bounding box**, while **negative margin moves the bounding box itself**. By combining:
- Large top padding (57px) to create internal space
- Large negative top margin (-67px) to move the bounding box up
- The blur effects (extending 18px) now fit within the wrapper's padded area

The wrapper's bounding box effectively starts at a negative Y position, but the padding creates a "safe zone" where the blur can exist without being clipped.

### Why This Works

1. **Bounding Box Position**: With `margin-top: -67px`, if the wrapper would normally be at `top: 20px`, it's now at `top: -47px` (20 - 67).

2. **Content Area**: With `padding-top: 57px`, the content area starts at `-47px + 57px = 10px`.

3. **Blur Space**: The blur extends 18px above the button. If the button is at `top: 60px`, the blur needs to be visible from `42px`. Since the wrapper's bounding box starts at `-47px` and has 57px padding, the blur at `42px` is well within the safe zone.

4. **No Clipping**: Because the blur is within the wrapper's bounding box (even though the box extends into negative space), and the container allows overflow, the blur is fully visible.

### Testing and Verification

The fix was verified by:
1. Rendering the page in a browser at StandByMe resolution (1920x1080)
2. Inspecting element positions and overflow properties
3. Calculating blur extension vs. wrapper boundaries
4. Taking screenshots to visually confirm no clipping
5. Iteratively adjusting padding/margin values until clipping was eliminated

### Files Modified
- `webos-app/styles.css`:
  - `.container`: Changed `overflow-y: auto` to `overflow-y: visible`
  - `.actions-carousel`: Adjusted margin and padding
  - `.actions-track-wrapper`: Increased top padding to 57px, negative margin to -67px
  - Added specific rule for `.divider + .actions-carousel .actions-track-wrapper`

### Lessons Learned

1. **Browser Overflow Behavior**: You cannot override the browser's forced `overflow-y: auto` when `overflow-x: auto` is set. The solution is to work within this constraint by ensuring content fits within the element's bounding box.

2. **Padding vs Margin**: Padding creates internal space, margin moves the element. Combining both allows you to position an element while creating space for overflow content.

3. **Negative Space**: Using negative margins to move bounding boxes into "negative space" is a valid technique when you need to accommodate overflow content while maintaining scroll functionality.

4. **Multiple Layers**: Always check parent containers for overflow properties that might clip child content, not just the immediate parent.

