"use strict";

(function () {
  let targetProviderFn = null;
  let customContext = {};

  function detectVariant() {
    if (document.body && document.body.dataset && document.body.dataset.variant) {
      return document.body.dataset.variant;
    }
    const path = (window.location.pathname || "").toLowerCase();
    if (path.includes("scramble")) return "scramble";
    if (path.includes("stadium")) return "stadium";
    if (path.includes("facts")) return "facts";
    if (path.includes("scorecard")) return "scorecard";
    if (path.includes("connections")) return "connections";
    if (path.includes("journey")) return "journey";
    if (path.includes("pixel")) return "pixel";
    if (path.includes("puzzle")) return "puzzle";
    return "cricketle";
  }

  function resolveTarget() {
    if (typeof targetProviderFn === "function") {
      try {
        const val = targetProviderFn();
        if (val) {
          if (typeof val === "object") return val;
          return { name: String(val) };
        }
      } catch (_) {}
    }

    if (customContext.targetName) {
      return {
        name: customContext.targetName,
        id: customContext.targetId || "",
        photoUrl: customContext.photoUrl || ""
      };
    }

    const selectors = [
      "#player-reveal-name",
      "#result-name",
      "#today-target",
      "#target-name",
      "#today-stadium-name",
      "#stadium-title",
      "#scramble-player-name",
      "#today-mystery-name",
      "#today-match-summary"
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent) {
        const text = el.textContent.trim();
        if (text && text !== "-" && text !== "..." && !text.includes("TODAY'S MYSTERY")) {
          return { name: text };
        }
      }
    }

    if (window.targetPlayer && window.targetPlayer.name) {
      return { name: window.targetPlayer.name, id: window.targetPlayer.id || "" };
    }
    if (window.todayStadium && window.todayStadium.name) {
      return { name: window.todayStadium.name };
    }
    if (window.todayMystery && window.todayMystery.name) {
      return { name: window.todayMystery.name };
    }
    if (window.todayCricketer && window.todayCricketer.name) {
      return { name: window.todayCricketer.name };
    }
    if (window.todayMatch && window.todayMatch.summary) {
      return { name: window.todayMatch.summary };
    }

    return { name: "" };
  }

  function showToastMessage(msg, type = "info") {
    if (typeof window.toast === "function") {
      window.toast(msg, type);
      return;
    }
    if (typeof window.showToast === "function") {
      window.showToast(msg, type);
      return;
    }
    let toastEl = document.getElementById("universal-inaccuracy-toast");
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "universal-inaccuracy-toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      toastEl.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e293b;color:#f8fafc;border:1px solid #334155;border-radius:10px;padding:12px 20px;font-size:14px;font-weight:600;box-shadow:0 10px 25px rgba(0,0,0,0.4);z-index:99999;transition:opacity 0.3s ease;pointer-events:none;display:flex;align-items:center;gap:8px;";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = "1";
    toastEl.hidden = false;
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => {
      toastEl.style.opacity = "0";
      setTimeout(() => { toastEl.hidden = true; }, 300);
    }, 4000);
  }

  function getOrCreateDialog() {
    let dialog = document.getElementById("inaccuracy-dialog");
    if (dialog) return dialog;

    dialog = document.createElement("dialog");
    dialog.id = "inaccuracy-dialog";
    dialog.className = "sheet inaccuracy-dialog";
    dialog.setAttribute("aria-labelledby", "report-dialog-title");

    dialog.innerHTML = `
      <button class="dialog-close icon-btn" type="button" id="report-dialog-close" aria-label="Close dialog">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="report-dialog-head">
        <div class="report-icon-pill">🚩</div>
        <div>
          <h2 id="report-dialog-title" style="margin:0; font-size:1.35rem; font-family:var(--font-display, inherit);">Report Inaccuracy</h2>
          <p class="muted small-text" style="margin:2px 0 0;">Notice a wrong answer, bad clue, or incorrect photo? Help us fix it!</p>
        </div>
      </div>

      <form id="inaccuracy-form" novalidate style="margin-top: 14px; text-align: left;">
        <div class="report-field">
          <label for="report-issue-type">What's inconsistent? <span class="req">*</span></label>
          <select id="report-issue-type" class="report-select" required>
            <option value="wrong_name" selected>Wrong name / incorrect answer</option>
            <option value="wrong_photo">Wrong photo / cricketer mismatch</option>
            <option value="incorrect_hint">Incorrect hint or career stat</option>
            <option value="bad_clue">Unclear or broken clue</option>
            <option value="other">Other inconsistency</option>
          </select>
        </div>

        <div class="report-field">
          <label for="report-target-info">Current Puzzle Target</label>
          <input type="text" id="report-target-info" class="report-input" readonly placeholder="Active puzzle" />
        </div>

        <div class="report-field">
          <label for="report-details">Correction details <span class="req">*</span></label>
          <textarea id="report-details" class="report-textarea" rows="3" placeholder="e.g. The clue says left-handed bowler, but he is a right-handed batsman..." required></textarea>
          <p id="report-details-error" class="field-error" aria-live="polite" style="color:var(--danger,#ef4444);font-size:12px;margin:3px 0 0;" hidden></p>
        </div>

        <div class="confirm-actions" style="margin-top: 16px; display: flex; gap: 8px; justify-content: flex-end;">
          <button type="button" id="report-cancel-btn" class="btn secondary">Cancel</button>
          <button type="submit" id="report-submit-btn" class="btn primary" style="background:#ef4444; border-color:#ef4444; color:#fff;">Submit Report</button>
        </div>
      </form>
    `;

    document.body.appendChild(dialog);
    wireDialogEvents(dialog);
    return dialog;
  }

  function wireDialogEvents(dialog) {
    if (dialog._wired) return;
    dialog._wired = true;

    const closeBtn = dialog.querySelector("#report-dialog-close");
    const cancelBtn = dialog.querySelector("#report-cancel-btn");
    const form = dialog.querySelector("#inaccuracy-form");
    const detailsText = dialog.querySelector("#report-details");
    const errorEl = dialog.querySelector("#report-details-error");
    const submitBtn = dialog.querySelector("#report-submit-btn");
    const issueSelect = dialog.querySelector("#report-issue-type");

    function closeDialog() {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      if (errorEl) errorEl.hidden = true;
    }

    closeBtn?.addEventListener("click", closeDialog);
    cancelBtn?.addEventListener("click", closeDialog);
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) closeDialog();
    });

    detailsText?.addEventListener("input", () => {
      if (errorEl) errorEl.hidden = true;
    });

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const details = (detailsText?.value || "").trim();
      if (!details) {
        if (errorEl) {
          errorEl.textContent = "Please provide details about the inconsistency.";
          errorEl.hidden = false;
        }
        detailsText?.focus();
        return;
      }

      const variant = customContext.variant || detectVariant();
      const resolved = resolveTarget();
      const targetName = customContext.targetName || resolved.name || "";
      const targetId = customContext.targetId || resolved.id || "";
      const photoUrl = customContext.photoUrl || resolved.photoUrl || "";
      const issueType = issueSelect?.value || "other";

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Submitting...";
      }

      try {
        const res = await fetch("/api/feedback/inaccuracy", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest"
          },
          body: JSON.stringify({
            variant,
            issueType,
            targetName,
            targetId,
            photoUrl,
            details
          })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || "Failed to submit inaccuracy report.");
        }

        closeDialog();
        if (form) form.reset();
        showToastMessage("🚩 Inaccuracy report sent! Thank you for keeping Cricketle accurate.", "success");
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err.message || "Network error. Please try again.";
          errorEl.hidden = false;
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit Report";
        }
      }
    });
  }

  function openDialog(options = {}) {
    customContext = options || {};
    const dialog = getOrCreateDialog();
    wireDialogEvents(dialog);

    const targetInput = dialog.querySelector("#report-target-info");
    const issueSelect = dialog.querySelector("#report-issue-type");
    const detailsText = dialog.querySelector("#report-details");
    const errorEl = dialog.querySelector("#report-details-error");

    const resolved = resolveTarget();
    const displayName = customContext.targetName || resolved.name || "Today's Puzzle";
    if (targetInput) targetInput.value = displayName;

    if (customContext.issueType && issueSelect) {
      issueSelect.value = customContext.issueType;
    }
    if (errorEl) errorEl.hidden = true;

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }

    setTimeout(() => {
      if (detailsText) detailsText.focus();
    }, 80);
  }

  function closeDialog() {
    const dialog = document.getElementById("inaccuracy-dialog");
    if (dialog) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }

  // Global API
  window.CricketleInaccuracy = {
    open: openDialog,
    close: closeDialog,
    setTargetProvider: function (fn) {
      targetProviderFn = fn;
    }
  };

  // Click delegation for any inaccuracy report triggers
  document.addEventListener("click", function (e) {
    const trigger = e.target.closest(
      "[data-report-inaccuracy], .report-inaccuracy-pill, .report-inaccuracy-btn, #btn-report-inaccuracy, #btn-result-report"
    );
    if (!trigger) return;

    // If trigger has data attributes, pass them in
    const context = {
      variant: trigger.dataset.variant || undefined,
      targetName: trigger.dataset.targetName || undefined,
      targetId: trigger.dataset.targetId || undefined,
      issueType: trigger.dataset.issueType || undefined
    };
    openDialog(context);
  });

  // Pre-wire if dialog is statically present
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      const d = document.getElementById("inaccuracy-dialog");
      if (d) wireDialogEvents(d);
    });
  } else {
    const d = document.getElementById("inaccuracy-dialog");
    if (d) wireDialogEvents(d);
  }
})();

