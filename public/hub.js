(function () {
  "use strict";

  // Theme toggle
  const toggleBtn = document.getElementById("theme-toggle");
  const iconUse = document.querySelector("#theme-icon use");

  function updateThemeIcon() {
    if (!iconUse) return;
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    iconUse.setAttribute("href", isDark ? "#i-sun" : "#i-moon");
  }

  toggleBtn?.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("cricketle_theme", next);
    updateThemeIcon();
  });

  updateThemeIcon();

  // Check user session
  fetch("/api/auth/me")
    .then((r) => r.json())
    .then((d) => {
      if (d.ok && d.user) {
        const userPill = document.getElementById("user-pill");
        const userName = document.getElementById("user-name");
        const loginBtn = document.getElementById("btn-login");
        if (userPill && userName && loginBtn) {
          userName.textContent = "@" + d.user.username;
          userPill.style.display = "inline-flex";
          loginBtn.style.display = "none";
        }
      }
    })
    .catch(() => {});
})();
