(function () {
  "use strict";

  // Check user session and update profile label
  fetch("/api/auth/me")
    .then((r) => r.json())
    .then((d) => {
      if (d.ok && d.user) {
        const label = document.getElementById("nav-profile-label");
        if (label) {
          label.textContent = "@" + d.user.username;
        }
      }
    })
    .catch(() => {});
})();
