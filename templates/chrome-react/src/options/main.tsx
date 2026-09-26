import { createRoot } from 'react-dom/client';
import { installGlobalErrorHandlers } from '@appforge/errors';
import { App } from './App.js';

installGlobalErrorHandlers(window, (event) => {
  console.error('[appforge-template:options]', event);
});

const container = document.getElementById('root');
if (!container) throw new Error('#root not found in options/index.html');
createRoot(container).render(<App />);
