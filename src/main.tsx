import React from 'react';
import ReactDOM from 'react-dom/client';
import './input.css';

// This is for the main index.html page
const container = document.getElementById('root');
if (container) {
  // For now, just render a simple message since this page doesn't seem to need React components
  ReactDOM.createRoot(container).render(
    <React.StrictMode></React.StrictMode>
  );
}
