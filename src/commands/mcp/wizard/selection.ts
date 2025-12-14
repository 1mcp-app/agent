import { RegistryServer } from '@src/domains/registry/types.js';

import { renderResultsList, showServerDetails } from './display.js';
import { getKeyInput } from './navigation.js';

/**
 * Selection result from server selection
 */
export interface SelectionResult {
  server?: RegistryServer;
  goBack: boolean;
  cancelled: boolean;
}

/**
 * Select a server from search results with arrow key navigation
 */
export async function selectFromResults(results: RegistryServer[]): Promise<SelectionResult> {
  let currentIndex = 0;
  let showingDetails = false;

  while (true) {
    console.clear();

    if (showingDetails) {
      // Show detail view
      await showServerDetails(results[currentIndex], getKeyInput);
      showingDetails = false;
      continue;
    }

    // Show results list
    renderResultsList(results, currentIndex);

    // Get key input
    const action = await getKeyInput();

    switch (action) {
      case 'up':
        currentIndex = Math.max(0, currentIndex - 1);
        break;

      case 'down':
        currentIndex = Math.min(results.length - 1, currentIndex + 1);
        break;

      case 'right':
        showingDetails = true;
        break;

      case 'left':
        return { goBack: true, cancelled: false };

      case 'enter':
        return { server: results[currentIndex], goBack: false, cancelled: false };

      case 'escape':
        return { cancelled: true, goBack: false };
    }
  }
}
