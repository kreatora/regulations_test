/**
 * graph-export.ts
 *
 * Single source of truth for "Download this graph as PNG" buttons.
 *
 * Why this exists:
 *   - The previous implementation walked the entire DOM, attached a Download
 *     button to *every* <svg> (including 18x18 icons inside buttons), and ran
 *     querySelectorAll('svg') again on every D3 mutation via a global
 *     MutationObserver. That's expensive and produces stray buttons all over
 *     the UI.
 *   - Cloning + serializing an SVG without inlining computed CSS and embedded
 *     <image> hrefs produces visually broken PNGs and canvas-taint failures.
 *
 * What this module offers:
 *   - `registerDownloadableGraph(svg, opts)`: explicit, opt-in API. Call it
 *     where a real graph/map SVG is created. Mounts one icon button in the
 *     container, no global observers, no auto-discovery.
 *   - A PNG export pipeline that (1) walks the SVG and inlines computed
 *     styles, (2) base64-inlines every <image href="..."> so the canvas does
 *     not taint, (3) renders at devicePixelRatio for crisp output, and
 *     (4) stamps a consistent Climate Policy Atlas footer (logo + brand +
 *     source line).
 */

const STYLE_ID = 'cpa-graph-export-styles';

const SOURCE_LINE =
    'Source: Climate Policy Atlas · Sustainability Transition Policy Group, FAU Erlangen-Nürnberg';

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

/**
 * Public API. Attach an icon-only Download button to a graph/map SVG.
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
    button.innerHTML = `${DOWNLOAD_ICON_SVG}<span class="cpa-download-btn-label">PNG</span>`;

    const setBusy = (busy: boolean) => {
        if (busy) {
            button.setAttribute('aria-busy', 'true');
            button.innerHTML = `<div class="cpa-download-btn-spinner" aria-hidden="true"></div><span class="cpa-download-btn-label">Exporting…</span>`;
        } else {
            button.removeAttribute('aria-busy');
            button.innerHTML = `${DOWNLOAD_ICON_SVG}<span class="cpa-download-btn-label">PNG</span>`;
        }
    };

    button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.getAttribute('aria-busy') === 'true') return;

        setBusy(true);
        try {
            const blob = await svgToPngBlob(svg, options.sourceLine || SOURCE_LINE);
            const slug = typeof options.filename === 'function' ? options.filename() : options.filename;
            triggerDownload(blob, buildExportFilename(slug));
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

function buildExportFilename(slug: string): string {
    const safeSlug = slug.replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    return `climate-policy-atlas-${safeSlug || 'graph'}-${yyyy}${mm}${dd}-${hh}${mi}.png`;
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

async function svgToPngBlob(svg: SVGSVGElement, sourceLine: string): Promise<Blob> {
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

    const footerHeight = 64;
    const pixelRatio = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));

    const graphImage = await loadImage(svgUrl);
    let logoImage: HTMLImageElement | null = null;
    try {
        const baseUrl = (import.meta as any).env.BASE_URL || '/';
        const logoSrc = `${baseUrl}images/CLIMATE POLICY ATLAS LOGO-Photoroom.png`;
        logoImage = await loadImage(logoSrc);
    } catch {
        // Logo is decorative — proceed without it if the asset is missing.
        logoImage = null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round((height + footerHeight) * pixelRatio);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context.');

    ctx.scale(pixelRatio, pixelRatio);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height + footerHeight);
    ctx.drawImage(graphImage, 0, 0, width, height);

    // Footer separator
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, height, width, 1);

    // Logo (if available)
    let textX = 16;
    if (logoImage) {
        const logoSize = 38;
        ctx.drawImage(logoImage, 16, height + 12, logoSize, logoSize);
        textX = 16 + logoSize + 12;
    }

    // Brand line
    ctx.fillStyle = '#1e293b';
    ctx.font = '700 14px Inter, Arial, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('Climate Policy Atlas', textX, height + 16);

    // Source line
    ctx.fillStyle = '#475569';
    ctx.font = '11px Inter, Arial, sans-serif';
    ctx.fillText(sourceLine, textX, height + 36);

    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
            'image/png',
            1.0
        );
    });
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
