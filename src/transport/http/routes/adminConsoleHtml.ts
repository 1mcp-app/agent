interface AdminConsoleHtmlOptions {
  status: 'setupRequired' | 'loginRequired';
}

export function renderAdminConsoleHtml(options: AdminConsoleHtmlOptions): string {
  return `<!doctype html>
<html lang="en" data-admin-status="${options.status}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>1MCP Admin</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #111827;
      --surface: #F7F8FA;
      --panel: #FFFFFF;
      --line: #D9DEE8;
      --action: #0E7C66;
      --danger: #B42318;
      --warning: #B54708;
      --muted: #5D6675;
      --focus: #2563EB;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--surface);
      color: var(--ink);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.35;
    }
    button, input { font: inherit; }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .status-strip {
      position: sticky;
      top: 0;
      z-index: 2;
      display: grid;
      grid-template-columns: minmax(120px, 1fr) repeat(4, minmax(90px, auto));
      gap: 1px;
      background: var(--line);
      border-bottom: 1px solid var(--line);
    }
    .status-cell {
      min-width: 0;
      padding: 8px 12px;
      background: var(--panel);
    }
    .status-label, th, .utility {
      color: var(--muted);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .status-value {
      overflow: hidden;
      margin-top: 2px;
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    main {
      width: min(1180px, 100%);
      margin: 0 auto;
      padding: 14px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
    }
    h1, h2 {
      margin: 0;
      font-size: 15px;
      line-height: 1.2;
    }
    h2 { margin-bottom: 8px; }
    .muted { color: var(--muted); }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      align-items: start;
    }
    .panel {
      min-width: 0;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 6px;
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
    }
    .panel-body { padding: 10px 12px; }
    .row {
      display: grid;
      grid-template-columns: minmax(120px, 1.1fr) minmax(90px, .6fr) minmax(150px, 1.4fr) auto;
      gap: 8px;
      align-items: center;
      min-height: 38px;
      padding: 7px 0;
      border-bottom: 1px solid var(--line);
    }
    .row:last-child { border-bottom: 0; }
    .row > * { min-width: 0; }
    .truncate {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      min-width: 132px;
    }
    .button {
      min-height: 30px;
      padding: 5px 9px;
      border: 1px solid var(--line);
      border-radius: 5px;
      background: var(--panel);
      color: var(--ink);
      cursor: pointer;
      white-space: nowrap;
    }
    .button.primary {
      border-color: var(--action);
      background: var(--action);
      color: white;
    }
    .button.danger {
      border-color: var(--danger);
      color: var(--danger);
    }
    .button:disabled {
      cursor: wait;
      opacity: .55;
    }
    .pill {
      display: inline-flex;
      max-width: 100%;
      min-height: 22px;
      align-items: center;
      padding: 2px 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
    .pill.ok { border-color: #9AD2C5; color: var(--action); }
    .pill.warn { border-color: #F3C98B; color: var(--warning); }
    .pill.danger { border-color: #E6A8A2; color: var(--danger); }
    .banner {
      display: none;
      margin-bottom: 10px;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 5px;
      background: var(--panel);
    }
    .banner.success { display: block; border-color: #9AD2C5; color: var(--action); }
    .banner.error { display: block; border-color: #E6A8A2; color: var(--danger); }
    form {
      display: grid;
      max-width: 360px;
      gap: 8px;
    }
    label {
      display: grid;
      gap: 4px;
      color: var(--muted);
    }
    input {
      width: 100%;
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 5px;
      padding: 6px 8px;
      background: white;
      color: var(--ink);
    }
    [hidden] { display: none !important; }
    @media (max-width: 820px) {
      .status-strip { grid-template-columns: 1fr 1fr; }
      .grid { grid-template-columns: 1fr; }
      .toolbar { align-items: flex-start; flex-direction: column; }
      .row { grid-template-columns: 1fr; gap: 4px; }
      .actions { justify-content: flex-start; }
    }
  </style>
</head>
<body>
  <section class="status-strip" aria-label="Runtime identity">
    <div class="status-cell"><div class="status-label">1MCP</div><div class="status-value">Admin Console</div></div>
    <div class="status-cell"><div class="status-label">Session</div><div class="status-value" id="strip-session">checking</div></div>
    <div class="status-cell"><div class="status-label">Runtime</div><div class="status-value" id="strip-runtime">unknown</div></div>
    <div class="status-cell"><div class="status-label">OAuth</div><div class="status-value" id="strip-oauth">unknown</div></div>
    <div class="status-cell"><div class="status-label">Updated</div><div class="status-value" id="strip-updated">never</div></div>
  </section>
  <main>
    <div id="banner" class="banner" role="status"></div>
    <section id="setup-view" class="panel" ${options.status === 'setupRequired' ? '' : 'hidden'}>
      <div class="panel-header"><h1>Setup required</h1><span class="pill warn">No Admin Account</span></div>
      <div class="panel-body">
        <p>Run CLI bootstrap from the runtime host, then refresh this page.</p>
        <p><code>1mcp admin bootstrap</code></p>
      </div>
    </section>
    <section id="login-view" class="panel" ${options.status === 'loginRequired' ? '' : 'hidden'}>
      <div class="panel-header"><h1>Operator login</h1><span class="pill">Admin Session</span></div>
      <div class="panel-body">
        <form id="login-form">
          <label>Username <input id="login-username" autocomplete="username" required></label>
          <label>Password <input id="login-password" type="password" autocomplete="current-password" required></label>
          <button class="button primary" type="submit">Log in</button>
        </form>
      </div>
    </section>
    <section id="console-view" hidden>
      <div class="toolbar">
        <div>
          <h1>Runtime operations</h1>
          <div class="utility" id="account-line">Not authenticated</div>
        </div>
        <div class="actions">
          <button class="button" id="refresh-button" type="button">Refresh</button>
          <button class="button danger" id="logout-button" type="button">Log out</button>
        </div>
      </div>
      <div class="grid">
        <section class="panel">
          <div class="panel-header"><h2>Configured servers</h2><span class="utility" id="server-count">0 targets</span></div>
          <div class="panel-body" id="server-list"></div>
        </section>
        <section class="panel">
          <div class="panel-header"><h2>OAuth status</h2><span class="utility" id="oauth-count">0 services</span></div>
          <div class="panel-body" id="oauth-list"></div>
        </section>
        <section class="panel">
          <div class="panel-header"><h2>Recent audit facts</h2><span class="utility">redacted</span></div>
          <div class="panel-body" id="audit-list"></div>
        </section>
        <section class="panel">
          <div class="panel-header"><h2>Runtime identity</h2><span class="utility">low disclosure</span></div>
          <div class="panel-body" id="runtime-list"></div>
        </section>
      </div>
    </section>
  </main>
  <script>
    const POLL_INTERVAL_VISIBLE_MS = 5000;
    const POLL_INTERVAL_HIDDEN_MS = 60000;
    const state = { csrfToken: "", pollTimer: 0 };

    const el = (id) => document.getElementById(id);
    const text = (value) => value == null || value === "" ? "-" : String(value);

    function showBanner(kind, message) {
      const banner = el("banner");
      banner.className = "banner " + kind;
      banner.textContent = message;
    }

    function clearBanner() {
      const banner = el("banner");
      banner.className = "banner";
      banner.textContent = "";
    }

    function setView(name) {
      el("setup-view").hidden = name !== "setup";
      el("login-view").hidden = name !== "login";
      el("console-view").hidden = name !== "console";
    }

    async function requestJson(path, options) {
      const response = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, options || {}));
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || body.code || response.statusText);
      }
      return body;
    }

    async function loadSession() {
      let session;
      try {
        session = await requestJson("/admin/api/session");
      } catch {
        state.csrfToken = "";
        el("strip-session").textContent = document.documentElement.dataset.adminStatus === "setupRequired" ? "setup required" : "logged out";
        setView(document.documentElement.dataset.adminStatus === "setupRequired" ? "setup" : "login");
        schedulePoll();
        return;
      }

      state.csrfToken = session.csrfToken;
      renderSession(session);
      setView("console");
      await refreshConsole("Session loaded, but refresh failed: ");
      schedulePoll();
    }

    function renderSession(session) {
      el("strip-session").textContent = session.account.username;
      el("account-line").textContent = session.account.username + " / " + session.account.role + " / expires " + session.expiresAt;
    }

    async function refreshAll() {
      if (!state.csrfToken) return;
      clearBanner();
      const status = await requestJson("/admin/api/status");
      const servers = await requestJson("/admin/api/configured-servers");
      renderStatus(status);
      renderServers(servers.servers || []);
      el("strip-updated").textContent = new Date().toLocaleTimeString();
    }

    async function refreshConsole(errorPrefix) {
      try {
        await refreshAll();
      } catch (error) {
        showBanner("error", errorPrefix + error.message);
      }
    }

    function renderStatus(status) {
      el("strip-runtime").textContent = status.runtime.runtimeVersion + " / " + status.runtime.runtimeScopeId;
      el("strip-oauth").textContent = status.oauth.status;
      renderOauth(status.oauth.services || []);
      renderAudit(status.audit.facts || []);
      renderRuntime(status.runtime);
    }

    function renderRuntime(runtime) {
      el("runtime-list").innerHTML = [
        row("Scope", runtime.runtimeScopeId, "", ""),
        row("Version", runtime.runtimeVersion, "", ""),
        row("External URL", runtime.externalUrl, "", "")
      ].join("");
    }

    function renderOauth(services) {
      el("oauth-count").textContent = services.length + " services";
      el("oauth-list").innerHTML = services.length ? services.map((service) =>
        row(service.name, service.status, service.requiresOAuth ? "OAuth required" : "No OAuth", service.lastError || "")
      ).join("") : '<div class="muted">No OAuth services reported.</div>';
    }

    function renderAudit(facts) {
      el("audit-list").innerHTML = facts.length ? facts.map((fact) =>
        row(fact.operationName, fact.result, fact.target && fact.target.id, fact.timestamp)
      ).join("") : '<div class="muted">No recent admin audit facts.</div>';
    }

    function renderServers(servers) {
      el("server-count").textContent = servers.length + " targets";
      el("server-list").innerHTML = servers.length ? servers.map((server) => {
        const statusClass = server.enabled ? "ok" : "warn";
        const action = server.enabled
          ? '<button class="button danger" type="button" onclick="disableServer(this.dataset.name)" data-name="' + escapeAttribute(server.id) + '">Disable</button>'
          : '<button class="button primary" type="button" onclick="enableServer(this.dataset.name)" data-name="' + escapeAttribute(server.id) + '">Enable</button>';
        return '<div class="row" id="server-row-' + escapeAttribute(server.id) + '"><strong class="truncate">' + escapeHtml(server.id) + '</strong><span class="pill ' + statusClass + '">' + (server.enabled ? "enabled" : "disabled") + '</span><span class="truncate muted">' + escapeHtml(describeTransport(server.transport)) + '</span><span class="actions">' + action + '</span></div>';
      }).join("") : '<div class="muted">No configured servers.</div>';
    }

    function row(a, b, c, d) {
      return '<div class="row"><strong class="truncate">' + escapeHtml(text(a)) + '</strong><span class="truncate">' + escapeHtml(text(b)) + '</span><span class="truncate muted">' + escapeHtml(text(c)) + '</span><span class="truncate utility">' + escapeHtml(text(d)) + '</span></div>';
    }

    function describeTransport(transport) {
      if (!transport || typeof transport !== "object") return "unknown";
      if (transport.command) return transport.command;
      if (transport.url) return transport.url;
      if (transport.type) return transport.type;
      return "configured";
    }

    async function enableServer(name) {
      await mutateServer(name, "enable");
    }

    async function disableServer(name) {
      await mutateServer(name, "disable");
    }

    async function mutateServer(name, action) {
      setRowState(name, "busy");
      try {
        await requestJson("/admin/api/configured-servers/" + encodeURIComponent(name) + "/" + action, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": state.csrfToken,
            "Idempotency-Key": "browser-" + action + "-" + name + "-" + Date.now()
          },
          body: "{}"
        });
        setRowState(name, "server-action-success");
        showBanner("success", "Server " + action + " completed.");
        await refreshAll();
      } catch (error) {
        setRowState(name, "server-action-error");
        showBanner("error", "Server " + action + " failed: " + error.message);
      }
    }

    function setRowState(name, className) {
      const rowEl = el("server-row-" + name);
      if (rowEl) rowEl.dataset.state = className;
    }

    function schedulePoll() {
      window.clearTimeout(state.pollTimer);
      const interval = document.visibilityState === "hidden" ? POLL_INTERVAL_HIDDEN_MS : POLL_INTERVAL_VISIBLE_MS;
      state.pollTimer = window.setTimeout(async () => {
        if (state.csrfToken) await refreshAll().catch((error) => showBanner("error", error.message));
        schedulePoll();
      }, interval);
    }

    function escapeHtml(value) {
      return text(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
    }

    function escapeAttribute(value) {
      return escapeHtml(value);
    }

    el("login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      let session;
      try {
        session = await requestJson('/admin/api/session/login', {
          method: "POST",
          body: JSON.stringify({ username: el("login-username").value, password: el("login-password").value })
        });
      } catch (error) {
        showBanner("error", "Login failed: " + error.message);
        return;
      }

      state.csrfToken = session.csrfToken;
      renderSession(session);
      setView("console");
      await refreshConsole("Login succeeded, but refresh failed: ");
    });

    el("logout-button").addEventListener("click", async () => {
      try {
        await requestJson('/admin/api/session/logout', { method: "POST", headers: { "X-CSRF-Token": state.csrfToken } });
      } finally {
        state.csrfToken = "";
        setView("login");
        el("strip-session").textContent = "logged out";
      }
    });

    el("refresh-button").addEventListener("click", () => refreshAll().catch((error) => showBanner("error", error.message)));
    document.addEventListener('visibilitychange', schedulePoll);
    loadSession();
  </script>
</body>
</html>`;
}
