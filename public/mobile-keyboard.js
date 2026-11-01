/**
 * Cricketle Mobile Virtual Keyboard & Clue-In-View Manager
 * =======================================================
 * Ensures convenient typing on mobile devices by:
 * 1. Detecting virtual keyboard open/close via visualViewport and focus events.
 * 2. Toggling the 'keyboard-open' class on document.body to:
 *    - Hide the fixed bottom .tabbar so it doesn't float over the keyboard or suggestions.
 *    - Unstick the sticky .mobile-variants-bar so clues have maximal vertical room.
 *    - Compact clue cards (timeline, SVG blueprint, scorecard table) so they stay visible while typing.
 * 3. Smoothly scrolling and centering the active input inside the visible viewport.
 */
(function () {
  "use strict";

  const isMobileOrTablet = () => window.innerWidth <= 768;

  let initialViewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;

  function handleFocus(e) {
    if (!isMobileOrTablet()) return;
    const target = e.target;
    if (!target) return;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      document.body.classList.add("keyboard-open");
      // Wait for the virtual keyboard slide-up animation (typically 200-300ms)
      setTimeout(() => {
        try {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch (_) {
          target.scrollIntoView(false);
        }
      }, 260);
    }
  }

  function handleBlur(e) {
    if (!isMobileOrTablet()) return;
    const target = e.target;
    if (!target) return;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      setTimeout(() => {
        const active = document.activeElement;
        if (!active || (active.tagName !== "INPUT" && active.tagName !== "TEXTAREA")) {
          document.body.classList.remove("keyboard-open");
        }
      }, 140);
    }
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      if (!isMobileOrTablet()) return;
      const currentHeight = window.visualViewport.height;
      // Virtual keyboard takes at least ~120px height
      const isKeyboardVisible = (initialViewportHeight - currentHeight) > 120;
      if (isKeyboardVisible) {
        document.body.classList.add("keyboard-open");
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
          setTimeout(() => {
            try {
              active.scrollIntoView({ behavior: "smooth", block: "center" });
            } catch (_) {}
          }, 60);
        }
      } else {
        const active = document.activeElement;
        if (!active || (active.tagName !== "INPUT" && active.tagName !== "TEXTAREA")) {
          document.body.classList.remove("keyboard-open");
        }
      }
    });

    window.addEventListener("orientationchange", () => {
      setTimeout(() => {
        if (window.visualViewport) {
          initialViewportHeight = window.visualViewport.height;
        }
      }, 300);
    });
  }

  document.addEventListener("focusin", handleFocus);
  document.addEventListener("focusout", handleBlur);
})();
