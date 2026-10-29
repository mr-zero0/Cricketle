// Cricketle admin console. Loaded by admin.html; talks to /api/admin/* with the
// admin cookie. No inline scripts or handlers: the page ships under
// Content-Security-Policy script-src 'self'.
"use strict";

const avatarIcons = {
  batter: "🏏", bowler: "⚡", spinner: "🌀", keeper: "🧤", captain: "🧢",
  allrounder: "🏅", legend: "🏆", stumps: "🎯", pads: "🦵",
};

function showToast(msg, isError = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.borderColor = isError ? "var(--danger)" : "var(--accent)";
  t.style.display = "flex";
  setTimeout(() => { t.style.display = "none"; }, 3500);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function checkAuth() {
  try {
    showDashboard(await api("/api/admin/stats"));
  } catch (_) {
    showLogin();
  }
}

function showLogin() {
  document.getElementById("auth-view").style.display = "block";
  document.getElementById("dashboard-view").style.display = "none";
  document.getElementById("btn-logout").style.display = "none";
}

function showDashboard(stats) {
  document.getElementById("auth-view").style.display = "none";
  document.getElementById("dashboard-view").style.display = "block";
  document.getElementById("btn-logout").style.display = "inline-flex";

  if (stats) {
    document.getElementById("metric-players").textContent = stats.totalUsers || 0;
    document.getElementById("metric-db").textContent = stats.dbEngine || "Database";
    document.getElementById("metric-day").textContent = stats.day || "-";
  }
  loadUsers();
}

let searchTimeout = null;
document.getElementById("user-search").addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    loadUsers(e.target.value);
  }, 300);
});

document.getElementById("btn-refresh").addEventListener("click", () => {
  loadUsers(document.getElementById("user-search").value);
});

async function loadUsers(search = "") {
  const tbody = document.getElementById("users-tbody");
  tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 36px;">Loading players...</td></tr>';

  try {
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    const data = await api(`/api/admin/users${query}`);
    const users = data.users || [];
    const total = data.total || 0;

    document.getElementById("metric-players").textContent = total;

    if (!users || users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 36px;">No players found.</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(u => {
      const icon = avatarIcons[u.avatar] || "🏏";
      const dateStr = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "-";
      const phone = u.phone || "No phone";
      const adminTag = u.isAdmin ? '<span class="tag-admin">Admin</span>' : '';

      return `
        <tr>
          <td>
            <div class="user-cell">
              <div class="user-avatar">${icon}</div>
              <div>
                <div class="user-name">${escapeHtml(u.displayName || u.username)}${adminTag}</div>
                <div class="user-handle">@${escapeHtml(u.username)}</div>
              </div>
            </div>
          </td>
          <td>
            <span class="phone-tag">${escapeHtml(phone)}</span>
          </td>
          <td style="color: var(--text-muted);">${dateStr}</td>
          <td>
            <div class="action-group">
              <button class="btn btn-secondary btn-sm" type="button" data-action="reset" data-id="${u.id}" data-username="${escapeHtml(u.username)}" data-phone="${escapeHtml(phone)}">🔑 Reset PIN</button>
              <button class="btn btn-danger btn-sm" type="button" data-action="delete" data-id="${u.id}" data-username="${escapeHtml(u.username)}">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--danger); padding: 36px;">Failed to load players: ${escapeHtml(err.message)}</td></tr>`;
  }
}

document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pass = document.getElementById("admin-pass").value.trim();
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ key: pass }),
    });
    showToast("✅ Admin login successful!");
    checkAuth();
  } catch (err) {
    showToast(err.message || "Invalid Admin Key", true);
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  try { await api("/api/admin/logout", { method: "POST" }); } catch (_) {}
  showToast("Signed out.");
  showLogin();
});

// Reset Modal
function openResetModal(id, username, phone) {
  document.getElementById("reset-user-id").value = id;
  document.getElementById("reset-target-name").textContent = "@" + username;
  document.getElementById("reset-target-phone").textContent = phone;
  document.getElementById("reset-new-pin").value = "";
  document.getElementById("modal-reset").style.display = "flex";
}

function closeResetModal() {
  document.getElementById("modal-reset").style.display = "none";
}

function generateRandomPin() {
  const pin = Math.floor(100000 + Math.random() * 900000);
  document.getElementById("reset-new-pin").value = pin;
}

document.getElementById("form-reset-pin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const userId = document.getElementById("reset-user-id").value;
  const newPin = document.getElementById("reset-new-pin").value;
  try {
    const res = await api("/api/admin/user/reset-pin", {
      method: "POST",
      body: JSON.stringify({ userId, newPin }),
    });
    showToast(res.message || "PIN reset successfully!");
    closeResetModal();
  } catch (err) {
    showToast(err.message || "Failed to reset PIN", true);
  }
});

async function deleteUser(userId, username) {
  if (!confirm(`Are you sure you want to permanently delete player @${username}?`)) {
    return;
  }
  try {
    await api("/api/admin/user/delete", {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
    showToast(`Player @${username} deleted.`);
    loadUsers(document.getElementById("user-search").value);
  } catch (err) {
    showToast(err.message, true);
  }
}

// Row actions and modal buttons (no inline handlers: the CSP is script-src 'self').
document.getElementById("users-tbody").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const { action, id, username, phone } = btn.dataset;
  if (action === "reset") openResetModal(id, username, phone);
  else if (action === "delete") deleteUser(id, username);
});
document.getElementById("btn-close-reset").addEventListener("click", closeResetModal);
document.getElementById("btn-generate-pin").addEventListener("click", generateRandomPin);

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

checkAuth();
