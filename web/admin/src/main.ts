import './styles.css';

const root = document.querySelector<HTMLDivElement>('#admin-root');

if (!root) {
  throw new Error('Admin Console root element was not found');
}

root.innerHTML = `
  <main class="admin-console" aria-label="1MCP Admin Console">
    <section class="status-strip" aria-label="Runtime identity">
      <div class="status-cell">
        <span class="status-label">1MCP</span>
        <strong>Admin Console</strong>
      </div>
      <div class="status-cell">
        <span class="status-label">Session</span>
        <strong>Checking</strong>
      </div>
    </section>
  </main>
`;
