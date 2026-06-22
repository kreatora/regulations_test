/**
 * Live map/chart data attribution footer and "Learn more about this data" modal.
 */

import {
    ATLAS_SITE_LABEL,
    getDatasetMetadata,
    type DatasetKey,
} from './data-metadata';
import type { GraphExportCaption } from './graph-export';

const STYLE_ID = 'cpa-data-attribution-styles';
let modalReady = false;

function ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        #map-data-attribution {
            display: none;
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 9;
            padding: 8px 14px 9px;
            background: rgba(255, 255, 255, 0.94);
            border-top: 1px solid rgba(203, 213, 225, 0.85);
            font: 400 10.5px/1.45 Inter, -apple-system, BlinkMacSystemFont, sans-serif;
            color: #64748b;
            text-align: left;
            pointer-events: auto;
        }
        #map-data-attribution.is-visible { display: block; }
        #world-map-container.has-data-attribution .regulations-map-panel-legend,
        #world-map-container.has-data-attribution .map-choropleth-legend {
            bottom: 58px;
        }
        #world-map-container.has-data-attribution .cpa-download-menu {
            bottom: 58px;
        }
        #map-data-attribution .map-data-source-line { margin: 0; }
        #map-data-attribution .map-data-citation-line {
            margin: 2px 0 0;
            font-size: 10px;
            color: #94a3b8;
        }
        #map-data-attribution .map-data-learn-more {
            margin: 0;
            padding: 0;
            border: none;
            background: none;
            color: #334155;
            font: inherit;
            text-decoration: underline;
            cursor: pointer;
        }
        #map-data-attribution .map-data-learn-more:hover { color: #0f172a; }
        .cpa-data-info-backdrop {
            position: fixed;
            inset: 0;
            z-index: 300;
            background: rgba(15, 23, 42, 0.55);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .cpa-data-info-modal {
            background: #fff;
            border-radius: 14px;
            max-width: 640px;
            width: 100%;
            max-height: min(88vh, 760px);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25);
        }
        .cpa-data-info-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
            padding: 18px 20px 14px;
            border-bottom: 1px solid rgba(203, 213, 225, 0.7);
        }
        .cpa-data-info-header h2 {
            margin: 0;
            font: 700 18px/1.3 'Libre Baskerville', Georgia, serif;
            color: #0f172a;
        }
        .cpa-data-info-close {
            background: none;
            border: none;
            font-size: 24px;
            line-height: 1;
            color: #64748b;
            cursor: pointer;
            padding: 0 2px;
        }
        .cpa-data-info-body {
            padding: 16px 20px 20px;
            overflow-y: auto;
            font: 400 13px/1.55 Inter, sans-serif;
            color: #334155;
        }
        .cpa-data-info-body h3 {
            margin: 16px 0 6px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.4px;
            text-transform: uppercase;
            color: #64748b;
        }
        .cpa-data-info-body h3:first-child { margin-top: 0; }
        .cpa-data-info-citation {
            margin: 0;
            padding: 12px 14px;
            background: #f8fafc;
            border: 1px solid rgba(148, 163, 184, 0.35);
            border-radius: 10px;
            font-size: 12.5px;
            line-height: 1.5;
            color: #1e293b;
        }
        .cpa-data-info-notes {
            margin: 0;
            padding-left: 18px;
        }
        .cpa-data-info-notes li { margin-bottom: 4px; }
        .cpa-data-info-links {
            margin: 0;
            padding: 0;
            list-style: none;
        }
        .cpa-data-info-links li { margin-bottom: 4px; }
        .cpa-data-info-links a { color: rgb(30, 64, 175); }
        .cpa-data-info-license a { color: rgb(30, 64, 175); }
    `;
    document.head.appendChild(style);
}

function ensureModal(): HTMLElement {
    if (modalReady) return document.getElementById('cpa-data-info-root')!;

    ensureStyles();
    const root = document.createElement('div');
    root.id = 'cpa-data-info-root';
    root.hidden = true;
    document.body.appendChild(root);
    modalReady = true;
    return root;
}

export function openDataInfoModal(key: DatasetKey): void {
    const meta = getDatasetMetadata(key);
    const root = ensureModal();

    const notesHtml = meta.notes?.length
        ? `<h3>Notes</h3><ul class="cpa-data-info-notes">${meta.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
        : '';

    const linksHtml = meta.relatedLinks?.length
        ? `<h3>Related links</h3><ul class="cpa-data-info-links">${meta.relatedLinks
              .map(
                  (l) =>
                      `<li><a href="${escapeAttr(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)}</a></li>`
              )
              .join('')}</ul>`
        : '';

    root.innerHTML = `
        <div class="cpa-data-info-backdrop" role="dialog" aria-modal="true" aria-labelledby="cpa-data-info-title">
            <div class="cpa-data-info-modal">
                <div class="cpa-data-info-header">
                    <h2 id="cpa-data-info-title">Learn more about this data</h2>
                    <button type="button" class="cpa-data-info-close" aria-label="Close">&times;</button>
                </div>
                <div class="cpa-data-info-body">
                    <h3>About</h3>
                    <p>${escapeHtml(meta.about)}</p>
                    <h3>Data source</h3>
                    <p>${escapeHtml(meta.dataSource)}</p>
                    <h3>How to cite</h3>
                    <p class="cpa-data-info-citation">${escapeHtml(meta.suggestedCitation)}</p>
                    <h3>License</h3>
                    <p class="cpa-data-info-license">
                        <a href="${escapeAttr(meta.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(meta.license)}</a>
                        — free to reuse with attribution.
                    </p>
                    ${notesHtml}
                    ${linksHtml}
                    <h3>Page</h3>
                    <p>${escapeHtml(`${ATLAS_SITE_LABEL}/${meta.pageSlug}`)}</p>
                </div>
            </div>
        </div>`;

    root.hidden = false;

    const close = () => {
        root.hidden = true;
        root.innerHTML = '';
    };

    root.querySelector('.cpa-data-info-close')?.addEventListener('click', close);
    root.querySelector('.cpa-data-info-backdrop')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) close();
    });
    document.addEventListener(
        'keydown',
        function onKey(e) {
            if (e.key === 'Escape') {
                close();
                document.removeEventListener('keydown', onKey);
            }
        },
        { once: false }
    );
}

export function updateMapDataAttribution(key: DatasetKey): void {
    ensureStyles();
    const meta = getDatasetMetadata(key);

    const container = document.getElementById('world-map-container');
    let footer = document.getElementById('map-data-attribution');
    if (!footer && container) {
        footer = document.createElement('div');
        footer.id = 'map-data-attribution';
        container.appendChild(footer);
    }
    if (!footer) return;

    footer.classList.add('is-visible');
    container?.classList.add('has-data-attribution');

    footer.innerHTML = `
        <p class="map-data-source-line">
            Data source: ${escapeHtml(meta.dataSource)} —
            <button type="button" class="map-data-learn-more">Learn more about this data</button>
        </p>
        <p class="map-data-citation-line">${escapeHtml(`${ATLAS_SITE_LABEL}/${meta.pageSlug}`)} | ${escapeHtml(meta.license)}</p>`;

    footer.querySelector('.map-data-learn-more')?.addEventListener('click', () => {
        openDataInfoModal(key);
    });
}

export function hideMapDataAttribution(): void {
    const footer = document.getElementById('map-data-attribution');
    footer?.classList.remove('is-visible');
    document.getElementById('world-map-container')?.classList.remove('has-data-attribution');
}

/** Merge chart title/subtitle with dataset metadata for PNG/PDF export. */
export function enrichExportCaption(
    caption: GraphExportCaption,
    key: DatasetKey
): GraphExportCaption {
    const meta = getDatasetMetadata(key);
    return {
        ...caption,
        dataSource: meta.dataSource,
        suggestedCitation: meta.suggestedCitation,
        license: meta.license,
        pageSlug: meta.pageSlug,
    };
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(text: string): string {
    return escapeHtml(text).replace(/'/g, '&#39;');
}
