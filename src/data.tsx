import React from 'react';
import ReactDOM from 'react-dom/client';
import { downloadFullDataset } from './dataset-download';

function wireDownloadAllDataLink(): void {
    const downloadLink = document.getElementById('download-all-data-link');
    if (!downloadLink) return;

    downloadLink.addEventListener('click', async (event) => {
        event.preventDefault();
        const originalText = downloadLink.textContent || 'here';

        try {
            downloadLink.textContent = 'Downloading...';
            downloadLink.style.pointerEvents = 'none';
            await downloadFullDataset();
        } catch (error) {
            console.error('Download failed:', error);
            window.alert('Download failed. Please try again.');
        } finally {
            downloadLink.textContent = originalText;
            downloadLink.style.pointerEvents = 'auto';
        }
    });
}

const container = document.getElementById('root');
if (container) {
    ReactDOM.createRoot(container).render(
        <React.StrictMode>
            <></>
        </React.StrictMode>
    );
}

wireDownloadAllDataLink();
