import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Capture the PWA install-prompt event as early as possible — it can fire
// before React mounts, so App reads it from here instead of racing it.
(window as any).__podcraftInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  (window as any).__podcraftInstallPrompt = e;
  window.dispatchEvent(new CustomEvent('podcraft-install-ready'));
});

// Register the service worker so the app is installable
// ("Download the app?" prompt). A failed registration only hides the
// prompt — the studio still works.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(<App />);
