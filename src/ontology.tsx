import React from 'react';
import ReactDOM from 'react-dom/client';
import OntologyVisualization from './components/ontologyvisualization';

// Mount the React app in the ontology-container div
const container = document.getElementById('ontology-container');
if (container) {
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <OntologyVisualization />
    </React.StrictMode>
  );
} else {
  console.error('Failed to find the ontology-container element.');
}
