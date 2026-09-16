import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { SiteLock } from './components/SiteLock.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SiteLock>
      <App />
    </SiteLock>
  </StrictMode>,
);
