(function () {
  "use strict";

  // Check user session and update profile label & tile statuses
  fetch("/api/me")
    .then((r) => r.json())
    .then((d) => {
      if (d && d.user) {
        const label = document.getElementById("nav-profile-label");
        if (label) {
          label.textContent = "@" + d.user.username;
        }

        const cricketleStatus = document.getElementById("status-cricketle");
        if (cricketleStatus) cricketleStatus.textContent = "3 Daily Puzzles";

        const scorecardStatus = document.getElementById("status-scorecard");
        if (scorecardStatus) scorecardStatus.textContent = "1 Daily Match";

        const puzzleStatus = document.getElementById("status-puzzle");
        if (puzzleStatus) puzzleStatus.textContent = "1 Daily Puzzle";

        const journeyStatus = document.getElementById("status-journey");
        if (journeyStatus) journeyStatus.textContent = "1 Daily Player";
      }
    })
    .catch(() => {});
})();
