/**
 * graph-export.ts
 *
 * Download controls for Climate Policy Atlas graphs and maps.
 *
 * - `registerGraphDownloadMenu(opts)`: "Graph and data" button with sidebar
 *   (graph exports + data downloads).
 * - `registerDownloadableGraph(svg, opts)`: legacy per-container PNG button.
 */

import { jsPDF } from 'jspdf';

const STYLE_ID = 'cpa-graph-export-styles';

import { ATLAS_SITE_LABEL } from './data-metadata';

const SOURCE_LINE =
    'Source: Climate Policy Atlas · Sustainability Transition Policy Group, FAU Erlangen-Nürnberg';

const HEADER_LOGO_MAX_WIDTH = 200;
const HEADER_LOGO_MAX_HEIGHT = 56;
const HEADER_PAD_X = 24;
const HEADER_PAD_TOP = 20;

// SVG style properties we copy from getComputedStyle into inline style.
// Keep this list short on purpose — copying every computed style makes the
// serialized SVG huge and slow.
const SVG_STYLE_PROPS = [
    'fill', 'fill-opacity', 'fill-rule',
    'stroke', 'stroke-opacity', 'stroke-width',
    'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
    'stroke-dasharray', 'stroke-dashoffset',
    'opacity', 'visibility',
    'color',
    'font-family', 'font-size', 'font-weight', 'font-style',
    'text-anchor', 'dominant-baseline', 'alignment-baseline',
    'paint-order', 'letter-spacing', 'word-spacing',
] as const;

export interface DownloadableGraphOptions {
    /**
     * Stable slug used in the filename, e.g. 'world-map-re-support'.
     * Pass a function to compute the slug at click-time (handy when the same
     * SVG is reused for several modes).
     */
    filename: string | (() => string);
    /** Tooltip / aria-label for the download button. */
    title?: string;
    /**
     * Where to mount the download button. Defaults to the SVG's parent
     * element. The container must be `position: relative|absolute|fixed`
     * (this helper will promote `static` to `relative` automatically).
     */
    container?: HTMLElement | null;
    /** Overrides the default Sources line at the bottom of the export. */
    sourceLine?: string;
}

export interface GraphExportCaption {
    title: string;
    subtitle?: string;
    legend?: string;
    /** Short data-source label (OWID-style footer line 1). */
    dataSource?: string;
    /** Full suggested citation for reuse (export footer). */
    suggestedCitation?: string;
    /** License shorthand, e.g. "CC BY 4.0". */
    license?: string;
    /** Page slug appended to ATLAS_SITE_LABEL in export footer. */
    pageSlug?: string;
    /**
     * When false, omit the header logo (e.g. when the live view already shows it elsewhere).
     * Default: true.
     */
    showHeaderLogo?: boolean;
}

export interface GraphDownloadMenuOptions {
    /** Mount point; menu button is anchored to this container by default. */
    container: HTMLElement;
    /** Resolve the SVG(s) currently visible to the user. */
    getActiveSvgs: () => SVGSVGElement | SVGSVGElement[] | null;
    /** Filename slug for graph exports. */
    getFilenameSlug: () => string;
    /** Human-readable title/subtitle/legend stamped on exported graphs. */
    getExportCaption?: () => GraphExportCaption | null;
    /** Overrides the default Sources line at the bottom of graph exports. */
    sourceLine?: string;
    /** Optional handler for "Full dataset" menu item. */
    onDownloadDataset?: () => void | Promise<void>;
    /** Show the full-dataset menu item (default: true when onDownloadDataset is set). */
    showDatasetOption?: boolean;
    /** Optional handler for country-scoped data export (dashboard). */
    onDownloadCountryData?: () => void | Promise<void>;
    /** Optional handler for country-scoped CSV export (dashboard). */
    onDownloadCountryDataCsv?: () => void | Promise<void>;
    /** Label for the country data menu item. */
    countryDataLabel?: string;
    /** Optional handler for full-dataset CSV export. */
    onDownloadDatasetCsv?: () => void | Promise<void>;
    /** How to arrange multiple SVGs in one export (default vertical). */
    exportLayout?: 'horizontal' | 'vertical';
    /** Resolve layout at export time (overrides exportLayout when set). */
    getExportLayout?: () => 'horizontal' | 'vertical';
    /** Tooltip for the trigger button. */
    title?: string;
    /** Pin to viewport instead of the container (default false). */
    fixed?: boolean;
}

let stylesInjected = false;

function ensureStyles(): void {
    if (stylesInjected || document.getElementById(STYLE_ID)) {
        stylesInjected = true;
        return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .cpa-download-btn {
            position: absolute;
            top: 8px;
            right: 8px;
            z-index: 30;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 6px 10px;
            border: 1px solid rgba(100, 116, 139, 0.45);
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.92);
            color: rgb(30, 41, 59);
            font: 600 11px Inter, -apple-system, BlinkMacSystemFont, sans-serif;
            letter-spacing: 0.2px;
            box-shadow: 0 2px 8px rgba(15, 23, 42, 0.12);
            cursor: pointer;
            backdrop-filter: blur(6px);
            transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
        }
        .cpa-download-btn:hover:not([aria-busy="true"]) {
            background: #ffffff;
            border-color: rgba(51, 65, 85, 0.75);
        }
        .cpa-download-btn:active:not([aria-busy="true"]) {
            transform: translateY(1px);
        }
        .cpa-download-btn[aria-busy="true"] {
            cursor: progress;
            opacity: 0.7;
        }
        .cpa-download-btn svg {
            width: 14px;
            height: 14px;
            display: block;
        }
        .cpa-download-btn .cpa-download-btn-spinner {
            width: 14px;
            height: 14px;
            border: 2px solid rgba(30, 41, 59, 0.25);
            border-top-color: rgb(30, 41, 59);
            border-radius: 50%;
            animation: cpa-download-spin 0.7s linear infinite;
        }
        @keyframes cpa-download-spin { to { transform: rotate(360deg); } }
        .cpa-download-toast {
            position: absolute;
            top: 50px;
            right: 12px;
            z-index: 31;
            padding: 8px 12px;
            background: rgba(15, 23, 42, 0.95);
            color: #ffffff;
            border-radius: 10px;
            font: 500 12px Inter, sans-serif;
            box-shadow: 0 6px 20px rgba(15, 23, 42, 0.3);
            opacity: 0;
            transform: translateY(-4px);
            transition: opacity 0.18s ease, transform 0.18s ease;
            pointer-events: none;
            max-width: 320px;
        }
        .cpa-download-toast.is-visible {
            opacity: 1;
            transform: translateY(0);
        }
        .cpa-download-menu {
            position: absolute;
            bottom: 16px;
            right: 16px;
            z-index: 30;
        }
        .cpa-download-menu.is-viewport-fixed {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 60;
        }
        .cpa-download-trigger {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 44px;
            height: 44px;
            padding: 0;
            border: 1px solid rgba(100, 116, 139, 0.42);
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.88);
            color: rgb(30, 41, 59);
            box-shadow: 0 4px 16px rgba(15, 23, 42, 0.12);
            cursor: pointer;
            backdrop-filter: blur(8px);
            transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .cpa-download-trigger:hover:not([aria-busy="true"]):not(:disabled),
        .cpa-download-menu.is-open .cpa-download-trigger {
            background: rgba(255, 255, 255, 0.94);
            border-color: rgba(100, 116, 139, 0.55);
            box-shadow: 0 5px 18px rgba(15, 23, 42, 0.15);
        }
        .cpa-download-trigger[aria-busy="true"],
        .cpa-download-trigger:disabled {
            cursor: progress;
            opacity: 0.75;
        }
        .cpa-download-trigger svg {
            width: 20px;
            height: 20px;
            display: block;
            flex-shrink: 0;
        }
        .cpa-download-sidebar {
            position: absolute;
            bottom: 0;
            right: calc(100% + 12px);
            width: 252px;
            max-height: min(70vh, 420px);
            overflow-y: auto;
            padding: 10px;
            border: 1px solid rgba(148, 163, 184, 0.55);
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.98);
            box-shadow: 0 16px 40px rgba(15, 23, 42, 0.2);
            backdrop-filter: blur(12px);
            opacity: 0;
            visibility: hidden;
            transform: translateX(10px);
            transition: opacity 0.18s ease, transform 0.18s ease, visibility 0.18s ease;
            pointer-events: none;
        }
        .cpa-download-menu.is-open .cpa-download-sidebar {
            opacity: 1;
            visibility: visible;
            transform: translateX(0);
            pointer-events: auto;
        }
        .cpa-download-sidebar-header {
            padding: 4px 10px 8px;
            font: 700 13px "Libre Baskerville", Georgia, serif;
            color: rgb(15, 23, 42);
            border-bottom: 1px solid rgba(226, 232, 240, 0.95);
            margin-bottom: 6px;
        }
        .cpa-download-section + .cpa-download-section {
            margin-top: 4px;
            padding-top: 4px;
            border-top: 1px solid rgba(226, 232, 240, 0.8);
        }
        .cpa-download-section-title {
            padding: 6px 10px 4px;
            font: 700 10px Inter, -apple-system, BlinkMacSystemFont, sans-serif;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgb(100, 116, 139);
        }
        .cpa-download-item {
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
            padding: 10px 12px;
            border: none;
            border-radius: 8px;
            background: transparent;
            color: rgb(30, 41, 59);
            font: 600 12px Inter, -apple-system, BlinkMacSystemFont, sans-serif;
            text-align: left;
            cursor: pointer;
            transition: background 0.12s ease;
        }
        .cpa-download-item:hover:not(:disabled) {
            background: rgba(30, 41, 59, 0.08);
        }
        .cpa-download-item:disabled {
            opacity: 0.55;
            cursor: not-allowed;
        }
        .cpa-download-item svg {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
        }
        .cpa-download-item-label {
            display: flex;
            flex-direction: column;
            gap: 2px;
            line-height: 1.25;
        }
        .cpa-download-item-note {
            font-weight: 500;
            font-size: 10px;
            color: rgb(100, 116, 139);
        }
        @media (max-width: 640px) {
            .cpa-download-sidebar {
                right: 0;
                bottom: calc(100% + 10px);
                width: min(92vw, 280px);
                max-height: min(60vh, 380px);
                transform: translateY(8px);
            }
            .cpa-download-menu.is-open .cpa-download-sidebar {
                transform: translateY(0);
            }
        }
    `;
    document.head.appendChild(style);
    stylesInjected = true;
}

const DOWNLOAD_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v12"/>
        <path d="M7 10l5 5 5-5"/>
        <path d="M5 21h14"/>
    </svg>
`;

const PNG_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <path d="M21 15l-5-5L5 21"/>
    </svg>
`;

const PDF_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <path d="M14 2v6h6"/>
        <path d="M10 13h4"/>
        <path d="M10 17h4"/>
    </svg>
`;

const DATASET_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <ellipse cx="12" cy="5" rx="7" ry="3"/>
        <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/>
        <path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>
    </svg>
`;

const CSV_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <path d="M14 2v6h6"/>
        <path d="M8 13h1"/>
        <path d="M8 17h1"/>
        <path d="M12 13h4"/>
        <path d="M12 17h4"/>
    </svg>
`;

const COUNTRY_DATA_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v10"/>
        <path d="M8 9l4 4 4-4"/>
        <path d="M4 17a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2H4v-2z"/>
    </svg>
`;

function normalizeSvgs(input: SVGSVGElement | SVGSVGElement[] | null): SVGSVGElement[] {
    if (!input) return [];
    return (Array.isArray(input) ? input : [input]).filter(Boolean);
}

/**
 * Fixed "Graph and data" button with a sidebar: graph exports + data downloads.
 */
export function registerGraphDownloadMenu(options: GraphDownloadMenuOptions): void {
    ensureStyles();

    const container = options.container;
    if (!container) return;
    if (container.querySelector('.cpa-download-menu')) return;

    const computedPos = getComputedStyle(container).position;
    if (computedPos === 'static') {
        container.style.position = 'relative';
    }

    const triggerLabel = options.title || 'Graph and data';

    const root = document.createElement('div');
    root.className = 'cpa-download-menu' + (options.fixed === true ? ' is-viewport-fixed' : '');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cpa-download-trigger';
    trigger.setAttribute('aria-label', triggerLabel);
    trigger.setAttribute('title', triggerLabel);
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = DOWNLOAD_ICON_SVG;

    const sidebar = document.createElement('aside');
    sidebar.className = 'cpa-download-sidebar';
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-label', triggerLabel);

    const sidebarHeader = document.createElement('div');
    sidebarHeader.className = 'cpa-download-sidebar-header';
    sidebarHeader.textContent = triggerLabel;
    sidebar.appendChild(sidebarHeader);

    const runBusy = async (action: () => void | Promise<void>) => {
        if (trigger.getAttribute('aria-busy') === 'true') return;
        closePanel();
        trigger.setAttribute('aria-busy', 'true');
        trigger.disabled = true;
        try {
            await action();
        } catch (err) {
            console.error('[graph-export] Download action failed', err);
            showToast(container, 'Download failed. See console for details.');
        } finally {
            trigger.removeAttribute('aria-busy');
            trigger.disabled = false;
        }
    };

    const makeItem = (icon: string, label: string, note: string | undefined, action: () => void | Promise<void>) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cpa-download-item';
        btn.setAttribute('role', 'menuitem');
        btn.innerHTML = `
            ${icon}
            <span class="cpa-download-item-label">
                <span>${label}</span>
                ${note ? `<span class="cpa-download-item-note">${note}</span>` : ''}
            </span>`;
        btn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await runBusy(action);
        });
        return btn;
    };

    const appendSection = (title: string, items: HTMLButtonElement[]) => {
        if (items.length === 0) return;
        const section = document.createElement('div');
        section.className = 'cpa-download-section';
        const heading = document.createElement('div');
        heading.className = 'cpa-download-section-title';
        heading.textContent = title;
        section.appendChild(heading);
        items.forEach((item) => section.appendChild(item));
        sidebar.appendChild(section);
    };

    const sourceLine = options.sourceLine || SOURCE_LINE;
    const resolveCaption = () => options.getExportCaption?.() || null;
    const resolveLayout = (): 'horizontal' | 'vertical' =>
        options.getExportLayout?.() ?? options.exportLayout ?? 'vertical';

    const graphItems = [
        makeItem(PNG_ICON_SVG, 'Graph as PNG', undefined, async () => {
            const svgs = normalizeSvgs(options.getActiveSvgs());
            if (svgs.length === 0) throw new Error('No graph is available to export.');
            const slug = options.getFilenameSlug();
            const layout = resolveLayout();
            const blob = await svgsToPngBlob(svgs, sourceLine, true, resolveCaption(), layout);
            triggerDownload(blob, buildExportFilename(slug, 'png'));
        }),
        makeItem(PDF_ICON_SVG, 'Graph as PDF', undefined, async () => {
            const svgs = normalizeSvgs(options.getActiveSvgs());
            if (svgs.length === 0) throw new Error('No graph is available to export.');
            const slug = options.getFilenameSlug();
            const layout = resolveLayout();
            const blob = await svgsToPdfBlob(svgs, sourceLine, true, resolveCaption(), layout);
            triggerDownload(blob, buildExportFilename(slug, 'pdf'));
        }),
    ];

    const dataItems: HTMLButtonElement[] = [];

    if (options.onDownloadCountryData) {
        dataItems.push(makeItem(
            COUNTRY_DATA_ICON_SVG,
            options.countryDataLabel || 'Country data',
            'Filtered .xlsx',
            async () => { await options.onDownloadCountryData!(); }
        ));
    }

    if (options.onDownloadCountryDataCsv) {
        dataItems.push(makeItem(
            CSV_ICON_SVG,
            options.countryDataLabel ? `${options.countryDataLabel} (csv)` : 'Country data (csv)',
            'Filtered .csv (zip)',
            async () => { await options.onDownloadCountryDataCsv!(); }
        ));
    }

    const showDataset = options.showDatasetOption !== false && !!options.onDownloadDataset;
    if (showDataset && options.onDownloadDataset) {
        dataItems.push(makeItem(DATASET_ICON_SVG, 'Full dataset', 'All countries (.xlsx)', async () => {
            await options.onDownloadDataset!();
        }));
    }

    const showDatasetCsv = options.showDatasetOption !== false && !!options.onDownloadDatasetCsv;
    if (showDatasetCsv && options.onDownloadDatasetCsv) {
        dataItems.push(makeItem(CSV_ICON_SVG, 'Full dataset (csv)', 'All countries (.csv zip)', async () => {
            await options.onDownloadDatasetCsv!();
        }));
    }

    appendSection('Graphs', graphItems);
    appendSection('Data downloads', dataItems);

    let closeTimer: number | undefined;
    const openPanel = () => {
        window.clearTimeout(closeTimer);
        root.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
    };
    const closePanel = () => {
        root.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
    };
    const scheduleClose = () => {
        window.clearTimeout(closeTimer);
        closeTimer = window.setTimeout(closePanel, 180);
    };
    const togglePanel = () => {
        if (root.classList.contains('is-open')) closePanel();
        else openPanel();
    };

    trigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        togglePanel();
    });

    root.addEventListener('mouseenter', openPanel);
    root.addEventListener('mouseleave', scheduleClose);
    sidebar.addEventListener('mouseenter', openPanel);
    sidebar.addEventListener('mouseleave', scheduleClose);

    const onDocumentClick = (event: MouseEvent) => {
        if (!root.contains(event.target as Node)) closePanel();
    };
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closePanel();
    });

    root.appendChild(sidebar);
    root.appendChild(trigger);
    container.appendChild(root);
}

/**
 * Legacy API. Attach an icon-only Download button to a graph/map SVG.
 *
 * Idempotent: calling twice on the same SVG is a no-op.
 */
export function registerDownloadableGraph(
    svg: SVGSVGElement | null | undefined,
    options: DownloadableGraphOptions
): void {
    if (!svg) return;
    if ((svg as any).dataset && (svg as any).dataset.cpaDownloadRegistered === 'true') return;

    ensureStyles();

    const container = options.container || svg.parentElement;
    if (!container) return;

    const computedPos = getComputedStyle(container).position;
    if (computedPos === 'static') {
        container.style.position = 'relative';
    }

    (svg as any).dataset.cpaDownloadRegistered = 'true';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cpa-download-btn';
    button.setAttribute('aria-label', options.title || 'Download graph as PNG');
    button.setAttribute('title', options.title || 'Download as PNG');
    button.innerHTML = DOWNLOAD_ICON_SVG;

    const setBusy = (busy: boolean) => {
        if (busy) {
            button.setAttribute('aria-busy', 'true');
            button.innerHTML = `<div class="cpa-download-btn-spinner" aria-hidden="true"></div>`;
        } else {
            button.removeAttribute('aria-busy');
            button.innerHTML = DOWNLOAD_ICON_SVG;
        }
    };

    button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.getAttribute('aria-busy') === 'true') return;

        setBusy(true);
        try {
            const blob = await svgsToPngBlob([svg], options.sourceLine || SOURCE_LINE, true);
            const slug = typeof options.filename === 'function' ? options.filename() : options.filename;
            triggerDownload(blob, buildExportFilename(slug, 'png'));
        } catch (err) {
            console.error('[graph-export] Failed to export graph', err);
            showToast(container, 'Export failed. See console for details.');
        } finally {
            setBusy(false);
        }
    });

    container.appendChild(button);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildExportFilename(slug: string, ext: 'png' | 'pdf' = 'png'): string {
    const safeSlug = slug.replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    return `climate-policy-atlas-${safeSlug || 'graph'}-${yyyy}${mm}${dd}-${hh}${mi}.${ext}`;
}

function resolveExportPixelRatio(maxQuality: boolean): number {
    if (maxQuality) {
        return Math.max(3, Math.min(4, (window.devicePixelRatio || 1) * 2));
    }
    return Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
}

async function prepareSvgImage(svg: SVGSVGElement): Promise<{ image: HTMLImageElement; width: number; height: number }> {
    const { width, height } = resolveSvgSize(svg);
    if (!width || !height) {
        throw new Error('Graph has zero size; cannot export.');
    }

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    if (!clone.getAttribute('viewBox')) {
        clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    inlineComputedStyles(svg, clone);
    await inlineImageHrefs(clone);

    const serialized = new XMLSerializer().serializeToString(clone);
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
    const image = await loadImage(svgUrl);
    return { image, width, height };
}

async function loadFooterLogo(): Promise<HTMLImageElement | null> {
    try {
        const baseUrl = (import.meta as any).env.BASE_URL || '/';
        const logoSrc = `${baseUrl}images/CLIMATE POLICY ATLAS LOGO-Photoroom.png`;
        return await loadImage(logoSrc);
    } catch {
        return null;
    }
}

/** Fit an image into a bounding box without changing aspect ratio. */
function fitImageRect(
    naturalWidth: number,
    naturalHeight: number,
    maxWidth: number,
    maxHeight: number
): { width: number; height: number } {
    if (!naturalWidth || !naturalHeight) {
        return { width: maxWidth, height: maxHeight };
    }
    const ratio = naturalWidth / naturalHeight;
    let width = maxWidth;
    let height = width / ratio;
    if (height > maxHeight) {
        height = maxHeight;
        width = height * ratio;
    }
    return { width, height };
}

function shouldShowHeaderLogo(caption?: GraphExportCaption | null): boolean {
    return caption?.showHeaderLogo !== false;
}

function resolveHeaderLogoRect(
    logoImage: HTMLImageElement | null,
    caption?: GraphExportCaption | null
): { width: number; height: number } | null {
    if (!logoImage || !shouldShowHeaderLogo(caption)) return null;
    return fitImageRect(
        logoImage.naturalWidth,
        logoImage.naturalHeight,
        HEADER_LOGO_MAX_WIDTH,
        HEADER_LOGO_MAX_HEIGHT
    );
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const lines: string[] = [];
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
        const test = `${line} ${words[i]}`;
        if (ctx.measureText(test).width > maxWidth) {
            lines.push(line);
            line = words[i];
        } else {
            line = test;
        }
    }
    lines.push(line);
    return lines;
}

function headerTextMaxWidth(width: number, logoRect: { width: number; height: number } | null): number {
    const logoReserve = logoRect ? logoRect.width + 16 : 0;
    return Math.max(120, width - HEADER_PAD_X * 2 - logoReserve);
}

function measureExportHeaderHeight(
    width: number,
    caption?: GraphExportCaption | null,
    logoRect: { width: number; height: number } | null = null
): number {
    if (!caption?.title) return 0;

    const temp = document.createElement('canvas').getContext('2d');
    if (!temp) return 96;

    const maxWidth = headerTextMaxWidth(width, logoRect);
    let height = HEADER_PAD_TOP;

    temp.font = '700 22px "Libre Baskerville", Georgia, serif';
    height += wrapCanvasText(temp, caption.title, maxWidth).length * 26;

    if (caption.subtitle) {
        temp.font = '400 13px Inter, Arial, sans-serif';
        height += wrapCanvasText(temp, caption.subtitle, maxWidth).length * 18 + 4;
    }

    if (caption.legend) {
        temp.font = '500 12px Inter, Arial, sans-serif';
        height += wrapCanvasText(temp, caption.legend, maxWidth).length * 16 + 2;
    }

    const logoHeight = logoRect?.height ?? 0;
    return Math.max(height + 18, HEADER_PAD_TOP + logoHeight + 12);
}

function drawExportHeader(
    ctx: CanvasRenderingContext2D,
    width: number,
    caption: GraphExportCaption | null | undefined,
    logoImage: HTMLImageElement | null,
    logoRect: { width: number; height: number } | null
): number {
    if (!caption?.title) return 0;

    const x = HEADER_PAD_X;
    const maxWidth = headerTextMaxWidth(width, logoRect);
    let y = HEADER_PAD_TOP;

    if (logoImage && logoRect) {
        ctx.drawImage(
            logoImage,
            width - HEADER_PAD_X - logoRect.width,
            HEADER_PAD_TOP,
            logoRect.width,
            logoRect.height
        );
    }

    ctx.textBaseline = 'top';
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 22px "Libre Baskerville", Georgia, serif';
    wrapCanvasText(ctx, caption.title, maxWidth).forEach((line) => {
        ctx.fillText(line, x, y);
        y += 26;
    });

    if (caption.subtitle) {
        ctx.fillStyle = '#475569';
        ctx.font = '400 13px Inter, Arial, sans-serif';
        y += 2;
        wrapCanvasText(ctx, caption.subtitle, maxWidth).forEach((line) => {
            ctx.fillText(line, x, y);
            y += 18;
        });
    }

    if (caption.legend) {
        ctx.fillStyle = '#64748b';
        ctx.font = '500 12px Inter, Arial, sans-serif';
        y += 2;
        wrapCanvasText(ctx, caption.legend, maxWidth).forEach((line) => {
            ctx.fillText(line, x, y);
            y += 16;
        });
    }

    const logoHeight = logoRect?.height ?? 0;
    const dividerY = Math.max(y + 8, HEADER_PAD_TOP + logoHeight + 8);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(HEADER_PAD_X, dividerY, width - HEADER_PAD_X * 2, 1);
    return dividerY + 14;
}

function measureExportFooterHeight(
    width: number,
    caption?: GraphExportCaption | null,
    legacySourceLine?: string
): number {
    const temp = document.createElement('canvas').getContext('2d');
    if (!temp) return caption?.dataSource ? 88 : 64;

    const maxWidth = Math.max(120, width - 32);
    let lines = 0;

    if (caption?.dataSource) {
        temp.font = '11px Inter, Arial, sans-serif';
        lines += wrapCanvasText(temp, `Data source: ${caption.dataSource}`, maxWidth).length;
        if (caption.suggestedCitation) {
            temp.font = '10px Inter, Arial, sans-serif';
            lines += wrapCanvasText(temp, `Suggested citation: ${caption.suggestedCitation}`, maxWidth).length;
        }
        const slug = caption.pageSlug || 'world-map';
        temp.font = '10px Inter, Arial, sans-serif';
        lines += 1; // `${ATLAS_SITE_LABEL}/${slug} | ${license}`
        void wrapCanvasText(temp, `${ATLAS_SITE_LABEL}/${slug} | ${caption.license || 'CC BY 4.0'}`, maxWidth);
    } else {
        temp.font = '11px Inter, Arial, sans-serif';
        lines += wrapCanvasText(temp, legacySourceLine || SOURCE_LINE, maxWidth).length + 1;
    }

    return 16 + lines * 14 + 12;
}

function drawExportFooter(
    ctx: CanvasRenderingContext2D,
    width: number,
    graphHeight: number,
    sourceLine: string,
    caption?: GraphExportCaption | null
): void {
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, graphHeight, width, 1);

    const x = 16;
    const maxWidth = Math.max(120, width - 32);
    let y = graphHeight + 14;
    ctx.textBaseline = 'top';

    if (caption?.dataSource) {
        ctx.fillStyle = '#64748b';
        ctx.font = '11px Inter, Arial, sans-serif';
        wrapCanvasText(ctx, `Data source: ${caption.dataSource}`, maxWidth).forEach((line) => {
            ctx.fillText(line, x, y);
            y += 14;
        });

        if (caption.suggestedCitation) {
            ctx.fillStyle = '#64748b';
            ctx.font = '10px Inter, Arial, sans-serif';
            wrapCanvasText(ctx, `Suggested citation: ${caption.suggestedCitation}`, maxWidth).forEach((line) => {
                ctx.fillText(line, x, y);
                y += 13;
            });
        }

        const slug = caption.pageSlug || 'world-map';
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px Inter, Arial, sans-serif';
        ctx.fillText(`${ATLAS_SITE_LABEL}/${slug} | ${caption.license || 'CC BY 4.0'}`, x, y);
        return;
    }

    ctx.fillStyle = '#64748b';
    ctx.font = '11px Inter, Arial, sans-serif';
    wrapCanvasText(ctx, sourceLine, maxWidth).forEach((line) => {
        ctx.fillText(line, x, y);
        y += 14;
    });
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, Arial, sans-serif';
    ctx.fillText(`${ATLAS_SITE_LABEL}/world-map | CC BY 4.0`, x, y);
}

function compositeGraphSize(
    parts: Array<{ width: number; height: number }>,
    layout: 'horizontal' | 'vertical',
    gap: number
): { width: number; height: number } {
    if (parts.length === 0) return { width: 0, height: 0 };
    if (parts.length === 1) return { width: parts[0].width, height: parts[0].height };

    if (layout === 'horizontal') {
        return {
            width: parts.reduce((sum, part, index) => sum + part.width + (index > 0 ? gap : 0), 0),
            height: Math.max(...parts.map((part) => part.height)),
        };
    }

    return {
        width: Math.max(...parts.map((part) => part.width)),
        height: parts.reduce((sum, part, index) => sum + part.height + (index > 0 ? gap : 0), 0),
    };
}

function drawCompositeGraphs(
    ctx: CanvasRenderingContext2D,
    parts: Array<{ image: HTMLImageElement; width: number; height: number }>,
    layout: 'horizontal' | 'vertical',
    gap: number,
    originX: number,
    originY: number,
    canvasWidth: number,
    canvasHeight: number
): void {
    if (layout === 'horizontal') {
        let xOffset = originX;
        parts.forEach((part, index) => {
            if (index > 0) xOffset += gap;
            const yOffset = originY + Math.max(0, (canvasHeight - part.height) / 2);
            ctx.drawImage(part.image, xOffset, yOffset, part.width, part.height);
            xOffset += part.width;
        });
        return;
    }

    let yOffset = originY;
    parts.forEach((part, index) => {
        if (index > 0) yOffset += gap;
        const xOffset = originX + Math.max(0, (canvasWidth - part.width) / 2);
        ctx.drawImage(part.image, xOffset, yOffset, part.width, part.height);
        yOffset += part.height;
    });
}

async function svgsToPngBlob(
    svgs: SVGSVGElement[],
    sourceLine: string,
    maxQuality = true,
    caption?: GraphExportCaption | null,
    layout: 'horizontal' | 'vertical' = 'vertical'
): Promise<Blob> {
    if (svgs.length === 0) {
        throw new Error('No graph is available to export.');
    }

    const parts = await Promise.all(svgs.map((svg) => prepareSvgImage(svg)));
    const gap = svgs.length > 1 ? 16 : 0;
    const graphSize = compositeGraphSize(parts, layout, gap);
    const width = graphSize.width;
    const graphHeight = graphSize.height;
    const logoImage = await loadFooterLogo();
    const logoRect = resolveHeaderLogoRect(logoImage, caption);
    const headerHeight = measureExportHeaderHeight(width, caption, logoRect);
    const footerHeight = measureExportFooterHeight(width, caption, sourceLine);
    const totalHeight = headerHeight + graphHeight + footerHeight;
    const pixelRatio = resolveExportPixelRatio(maxQuality);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(totalHeight * pixelRatio);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context.');

    ctx.scale(pixelRatio, pixelRatio);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, totalHeight);

    drawExportHeader(ctx, width, caption, logoImage, logoRect);
    drawCompositeGraphs(ctx, parts, layout, gap, 0, headerHeight, width, graphHeight);
    drawExportFooter(ctx, width, headerHeight + graphHeight, sourceLine, caption);

    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
            'image/png',
            1.0
        );
    });
}

async function svgsToPdfBlob(
    svgs: SVGSVGElement[],
    sourceLine: string,
    maxQuality = true,
    caption?: GraphExportCaption | null,
    layout: 'horizontal' | 'vertical' = 'vertical'
): Promise<Blob> {
    const pngBlob = await svgsToPngBlob(svgs, sourceLine, maxQuality, caption, layout);
    const pngDataUrl = await blobToDataUrl(pngBlob);
    const image = await loadImage(pngDataUrl);

    const orientation = image.width >= image.height ? 'landscape' : 'portrait';
    const doc = new jsPDF({
        orientation,
        unit: 'px',
        format: [image.width, image.height],
        compress: false,
    });
    doc.addImage(pngDataUrl, 'PNG', 0, 0, image.width, image.height, undefined, 'NONE');
    return doc.output('blob');
}

async function blobToDataUrl(blob: Blob): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

async function svgToPngBlob(svg: SVGSVGElement, sourceLine: string): Promise<Blob> {
    return svgsToPngBlob([svg], sourceLine, false);
}

/** Trigger a browser download for an in-memory blob. */
export function downloadBlob(blob: Blob, filename: string): void {
    triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function showToast(container: HTMLElement, message: string): void {
    const toast = document.createElement('div');
    toast.className = 'cpa-download-toast';
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    setTimeout(() => {
        toast.classList.remove('is-visible');
        setTimeout(() => toast.remove(), 250);
    }, 3500);
}

function resolveSvgSize(svg: SVGSVGElement): { width: number; height: number } {
    const viewBox = svg.getAttribute('viewBox');
    if (viewBox) {
        const parts = viewBox.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
            const [, , w, h] = parts;
            if (w > 0 && h > 0) {
                // For responsive SVGs we want the *displayed* size, not the
                // raw viewBox numbers — those are coordinate-space units and
                // can be small (e.g. 800x600 for a 1600px-wide rendered SVG).
                // Use the rendered size if it is sensible, fall back to the
                // viewBox numbers otherwise.
                const rect = svg.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    return { width: Math.round(rect.width), height: Math.round(rect.height) };
                }
                return { width: w, height: h };
            }
        }
    }

    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
    }

    const wAttr = parseFloat(svg.getAttribute('width') || '');
    const hAttr = parseFloat(svg.getAttribute('height') || '');
    if (Number.isFinite(wAttr) && Number.isFinite(hAttr) && wAttr > 0 && hAttr > 0) {
        return { width: wAttr, height: hAttr };
    }

    return { width: 0, height: 0 };
}

function inlineComputedStyles(orig: Element, clone: Element): void {
    if (orig.nodeType !== 1) return;
    const cs = getComputedStyle(orig as Element);
    let inline = '';
    for (const prop of SVG_STYLE_PROPS) {
        const value = cs.getPropertyValue(prop);
        if (value && value !== 'normal' && value !== 'auto') {
            inline += `${prop}:${value};`;
        }
    }
    if (inline) {
        const existing = (clone as HTMLElement).getAttribute('style') || '';
        (clone as HTMLElement).setAttribute('style', `${inline}${existing}`);
    }

    const origChildren = orig.children;
    const cloneChildren = clone.children;
    const n = Math.min(origChildren.length, cloneChildren.length);
    for (let i = 0; i < n; i++) {
        inlineComputedStyles(origChildren[i], cloneChildren[i]);
    }
}

async function inlineImageHrefs(root: SVGSVGElement): Promise<void> {
    const imageEls = Array.from(root.querySelectorAll('image'));
    if (imageEls.length === 0) return;

    await Promise.all(
        imageEls.map(async (el) => {
            const href =
                el.getAttribute('href') ||
                el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
            if (!href) return;
            if (href.startsWith('data:')) return;

            try {
                const dataUri = await fetchAsDataUri(href);
                el.setAttribute('href', dataUri);
                // Keep xlink:href for old viewers as well.
                el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dataUri);
            } catch (err) {
                // If we can't inline an image, strip it so the canvas does
                // not taint and the export still completes.
                console.warn('[graph-export] Failed to inline image, removing from export', href, err);
                el.parentNode?.removeChild(el);
            }
        })
    );
}

async function fetchAsDataUri(url: string): Promise<string> {
    const resp = await fetch(url, { cache: 'force-cache' });
    if (!resp.ok) throw new Error(`Fetch failed for ${url}: ${resp.status}`);
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        // Allow logos/data-URIs to be drawn to canvas without tainting.
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = src;
    });
}
