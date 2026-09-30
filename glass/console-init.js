// Control room: every action button becomes a glass galaxy button.
import { enhanceAll } from './glass.js';

enhanceAll('.fault-button, .route-button, .skip-opening, .text-link, .repl-seg-btn', (el) => ({
  size: el.classList.contains('repl-seg-btn') ? 'sm' : undefined,
}));
enhanceAll('.refresh-button, .clear-button', { size: 'sm' });
enhanceAll('.dialog-close', { orb: false, size: 'sm' });
