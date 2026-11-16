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

  // Check user session and update profile label & tile statuses
  fetch("/api/me")
    .then((r) => r.json())
    .then((d) => {
      if (d && d.user) applyUser(d.user);
    })
    .catch(() => {});
})();
