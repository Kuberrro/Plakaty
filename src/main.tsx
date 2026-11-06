import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import { App } from './App';
import { setupUpdates } from './ui/updates';

navigator.storage?.persist?.().catch(() => {});
setupUpdates();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
