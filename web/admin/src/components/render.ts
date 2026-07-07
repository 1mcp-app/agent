import type { AdminAuditFact, OAuthServiceStatus, RuntimeIdentity } from '../api/adminApi';
import type { AdminConsoleState, ServerMutation } from '../state/adminConsoleState';

export function renderApp(state: AdminConsoleState): string {
  return `
    <section class="status-strip" aria-label="Runtime identity">
      ${statusCell('1MCP', 'Admin Console')}
      ${statusCell('Session', sessionLabel(state))}
      ${statusCell('Runtime', runtimeLabel(state.status?.runtime))}
      ${statusCell('OAuth', state.status?.oauth.status ?? 'unknown')}
      ${statusCell('Updated', state.lastUpdatedAt ?? 'never')}
    </section>
    <main class="admin-console">
      ${renderBanner(state)}
      ${state.view === 'setupRequired' ? renderSetupRequired() : ''}
      ${state.view === 'login' || state.view === 'loading' ? renderLogin(state.view === 'loading') : ''}
      ${state.view === 'console' ? renderConsole(state) : ''}
    </main>
  `;
}

function renderSetupRequired(): string {
  return `
    <section class="panel" id="setup-view">
      <div class="panel-header">
        <h1>Setup required</h1>
        <span class="pill warn">No Admin Account</span>
      </div>
      <div class="panel-body">
        <p>Run CLI bootstrap from the runtime host, then refresh this page.</p>
        <p><code>1mcp admin bootstrap</code></p>
      </div>
    </section>
  `;
}

function renderLogin(loading: boolean): string {
  const disabled = loading ? 'disabled aria-disabled="true"' : '';
  return `
    <section class="panel" id="login-view">
      <div class="panel-header">
        <h1>Operator login</h1>
        <span class="pill">${loading ? 'Checking session' : 'Admin Session'}</span>
      </div>
      <div class="panel-body">
        <form id="login-form">
          <label>Username <input id="login-username" name="username" autocomplete="username" required ${disabled} /></label>
          <label>Password <input id="login-password" name="password" type="password" autocomplete="current-password" required ${disabled} /></label>
          <button class="button primary" type="submit" ${disabled}>${loading ? 'Checking' : 'Log in'}</button>
        </form>
      </div>
    </section>
  `;
}

function renderConsole(state: AdminConsoleState): string {
  return `
    <section id="console-view">
      <div class="toolbar">
        <div>
          <h1>Runtime operations</h1>
          <div class="utility">${escapeHtml(accountLine(state))}</div>
        </div>
        <div class="actions">
          <button class="button" id="refresh-button" type="button">Refresh</button>
          <button class="button danger" id="logout-button" type="button">Log out</button>
        </div>
      </div>
      <div class="grid">
        ${panel('Configured servers', `${state.configuredServers.length} targets`, renderServers(state))}
        ${panel('OAuth status', `${state.status?.oauth.services.length ?? 0} services`, renderOAuth(state.status?.oauth.services ?? []))}
        ${panel('Recent audit facts', 'redacted', renderAudit(state.status?.audit.facts ?? []))}
        ${panel('Runtime identity', 'low disclosure', renderRuntime(state.status?.runtime))}
      </div>
    </section>
  `;
}

function renderServers(state: AdminConsoleState): string {
  if (!state.configuredServers.length) {
    return '<div class="muted">No configured servers.</div>';
  }

  return state.configuredServers
    .map((server) => {
      const action = server.enabled ? 'disable' : 'enable';
      const mutation = state.serverMutations[server.id];
      const statusClass = server.enabled ? 'ok' : 'warn';
      const mutationClass = mutationClassName(mutation);
      return `
        <div class="row ${mutationClass}" id="server-row-${escapeAttribute(server.id)}">
          <strong class="truncate">${escapeHtml(server.id)}</strong>
          <span class="pill ${statusClass}">${server.enabled ? 'enabled' : 'disabled'}</span>
          <span class="truncate muted">${escapeHtml(describeTransport(server.transport))}</span>
          <span class="actions">
            <button class="button ${action === 'disable' ? 'danger' : 'primary'}" type="button" data-action="${action}" data-name="${escapeAttribute(server.id)}" ${mutation?.state === 'busy' ? 'disabled' : ''}>
              ${action === 'disable' ? 'Disable' : 'Enable'}
            </button>
          </span>
          ${mutation?.message ? `<span class="mutation-message">${escapeHtml(mutation.message)}</span>` : ''}
        </div>
      `;
    })
    .join('');
}

function renderOAuth(services: OAuthServiceStatus[]): string {
  if (!services.length) {
    return '<div class="muted">No OAuth services reported.</div>';
  }

  return services
    .map((service) =>
      detailRow(
        service.name,
        service.status,
        service.requiresOAuth ? 'OAuth required' : 'No OAuth',
        service.lastError ?? '',
      ),
    )
    .join('');
}

function renderAudit(facts: AdminAuditFact[]): string {
  if (!facts.length) {
    return '<div class="muted">No recent admin audit facts.</div>';
  }

  return facts
    .map((fact) =>
      detailRow(fact.operationName, fact.result, fact.target?.id ?? fact.operationId ?? '', fact.timestamp),
    )
    .join('');
}

function renderRuntime(runtime?: RuntimeIdentity): string {
  if (!runtime) {
    return '<div class="muted">Runtime status has not loaded.</div>';
  }

  return [
    detailRow('Scope', runtime.runtimeScopeId, '', ''),
    detailRow('Version', runtime.runtimeVersion, '', ''),
    detailRow('External URL', runtime.externalUrl ?? '-', '', ''),
  ].join('');
}

function renderBanner(state: AdminConsoleState): string {
  if (state.banner) {
    return `<div class="banner ${state.banner.kind}" role="${state.banner.kind === 'error' ? 'alert' : 'status'}">${escapeHtml(state.banner.message)}</div>`;
  }
  if (state.error) {
    return `<div class="banner error" role="alert">${escapeHtml(state.error)}</div>`;
  }
  return '';
}

function panel(title: string, utility: string, body: string): string {
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>${escapeHtml(title)}</h2>
        <span class="utility">${escapeHtml(utility)}</span>
      </div>
      <div class="panel-body">${body}</div>
    </section>
  `;
}

function statusCell(label: string, value: string): string {
  return `
    <div class="status-cell">
      <div class="status-label">${escapeHtml(label)}</div>
      <div class="status-value">${escapeHtml(value)}</div>
    </div>
  `;
}

function detailRow(primary: unknown, secondary: unknown, tertiary: unknown, meta: unknown): string {
  return `
    <div class="row detail-row">
      <strong class="truncate">${escapeHtml(text(primary))}</strong>
      <span class="truncate">${escapeHtml(text(secondary))}</span>
      <span class="truncate muted">${escapeHtml(text(tertiary))}</span>
      <span class="truncate utility">${escapeHtml(text(meta))}</span>
    </div>
  `;
}

function sessionLabel(state: AdminConsoleState): string {
  if (state.session) {
    return state.session.account.username;
  }
  if (state.view === 'setupRequired') {
    return 'setup required';
  }
  return state.view === 'loading' ? 'checking' : 'logged out';
}

function runtimeLabel(runtime?: RuntimeIdentity): string {
  if (!runtime) {
    return 'unknown';
  }
  return `${runtime.runtimeVersion} / ${runtime.runtimeScopeId}`;
}

function accountLine(state: AdminConsoleState): string {
  if (!state.session) {
    return 'Not authenticated';
  }
  return `${state.session.account.username} / ${state.session.account.role} / expires ${state.session.expiresAt}`;
}

function mutationClassName(mutation?: ServerMutation): string {
  if (!mutation) {
    return '';
  }
  return mutation.state === 'failed'
    ? 'server-action-error'
    : mutation.state === 'succeeded'
      ? 'server-action-success'
      : 'server-action-busy';
}

function describeTransport(transport: Record<string, unknown>): string {
  if (typeof transport.command === 'string') {
    return transport.command;
  }
  if (typeof transport.url === 'string') {
    return transport.url;
  }
  if (typeof transport.type === 'string') {
    return transport.type;
  }
  return 'configured';
}

function text(value: unknown): string {
  return value === undefined || value === null || value === '' ? '-' : String(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const escaped: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return escaped[char] ?? char;
  });
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
