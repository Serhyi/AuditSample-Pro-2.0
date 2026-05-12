import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { StorageProvider } from './contexts/StorageContext';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <StorageProvider>
      <App />
    </StorageProvider>
  </React.StrictMode>
);