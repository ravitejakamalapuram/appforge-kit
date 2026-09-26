import { createRoot } from 'react-dom/client';
import { installGlobalErrorHandlers } from '@appforge/errors';
import { App } from './App.js';

installGlobalErrorHandlers(window, (event) => {
  console.error('[appforge-template:popup]', event);
});

const container = document.getElementById('root');
if (!container) throw new Error('#root not found in popup/index.html');
createRoot(container).render(<App />);
