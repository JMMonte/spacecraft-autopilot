import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@/App.tsx';
import './styles/global.css';

const isDev = import.meta.env?.DEV === true;
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  isDev ? (
    // In development, avoid React 18 StrictMode double-invocation of effects
    <App />
  ) : (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
);
