import { createAdminApi } from './api/adminApi';
import { createAdminConsoleController } from './controller';
import './styles.css';

const root = document.querySelector<HTMLDivElement>('#admin-root');

if (!root) {
  throw new Error('Admin Console root element was not found');
}

const controller = createAdminConsoleController({
  root,
  api: createAdminApi(),
  documentRef: document,
  windowRef: window,
});

controller.render();
void controller.loadSession();
