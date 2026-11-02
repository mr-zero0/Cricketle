(function () {
  "use strict";

  function applyUser(user) {
    if (!user) return;
    const label = document.getElementById("nav-profile-label");
    if (label) {
      label.textContent = "@" + user.username;
    }

    const authBtn = document.getElementById("topbar-auth-btn");
    if (authBtn) {
      authBtn.classList.add("signed-in");
      authBtn.title = `@${user.username} (Account)`;
      authBtn.setAttribute("aria-label", `Account for @${user.username}`);
    }

    const cricketleStatus = document.getElementById("status-cricketle");
    if (cricketleStatus) cricketleStatus.textContent = "1 Daily Puzzle";

    const scorecardStatus = document.getElementById("status-scorecard");
    if (scorecardStatus) scorecardStatus.textContent = "1 Daily Match";

    const puzzleStatus = document.getElementById("status-puzzle");
    if (puzzleStatus) puzzleStatus.textContent = "3 Guesses Daily";

    const pixelStatus = document.getElementById("status-pixel");
    if (pixelStatus) pixelStatus.textContent = "6 Attempts Daily";

    const journeyStatus = document.getElementById("status-journey");
    if (journeyStatus) journeyStatus.textContent = "1 Daily Player";

    const connectionsStatus = document.getElementById("status-connections");
    if (connectionsStatus) connectionsStatus.textContent = "1 Daily Board";

    const stadiumStatus = document.getElementById("status-stadium");
    if (stadiumStatus) stadiumStatus.textContent = "1 Daily Venue";

    const factsStatus = document.getElementById("status-facts");
    if (factsStatus) factsStatus.textContent = "1 Daily Challenge";

    const scrambleStatus = document.getElementById("status-scramble");
    if (scrambleStatus) scrambleStatus.textContent = "6 Attempts Daily";
  }

  function initGoogleAuth(clientId) {
    if (!clientId || !window.google || !window.google.accounts) return;
    try {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response) => {
          if (!response || !response.credential) return;
          try {
            const res = await fetch("/api/auth/google", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential: response.credential }),
            });
            const data = await res.json();
            if (res.ok && data.user) {
              applyUser(data.user);
            }
          } catch (_) {}
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      window.google.accounts.id.prompt();
    } catch (_) {}
  }

  // Check user session and update profile label & tile statuses
  fetch("/api/me")
    .then((r) => r.json())
    .then((d) => {
      if (d && d.user) {
        applyUser(d.user);
      } else if (d && d.googleClientId) {
        if (window.google && window.google.accounts) {
          initGoogleAuth(d.googleClientId);
        } else {
          window.addEventListener("load", () => {
            initGoogleAuth(d.googleClientId);
          });
        }
      }
    })
    .catch(() => {});
})();
