import * as d3 from 'd3';
import * as XLSX_ from 'xlsx';
const XLSX = (XLSX_ as any).default || XLSX_;
import { geoMercator, geoPath } from 'd3-geo';
import polylabel from 'polylabel';
import { registerGraphDownloadMenu } from './graph-export';

// Helper: Add Climate Policy Atlas logo watermark to an SVG chart (top-right, reduced opacity)
function addLogoWatermark(svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, any>, svgWidth: number) {
    const logoSize = 70;
    const padding = 10;
    // Append logo after a short delay so it renders on top of all chart elements
    setTimeout(() => {
        svg.append('image')
            .attr('href', `${(import.meta as any).env.BASE_URL || '/'}images/CLIMATE POLICY ATLAS LOGO-Photoroom.png`)
            .attr('x', svgWidth - logoSize - padding)
            .attr('y', padding)
            .attr('width', logoSize)
            .attr('height', logoSize)
            .style('opacity', 0.25)
            .style('pointer-events', 'none');
    }, 50);
}

// Modal functionality for full-screen charts
function openModal() {
    const modal = document.getElementById('chart-modal');
    if (modal) {
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        initializeDragFunctionality();
    }
}

function closeModal() {
    const modal = document.getElementById('chart-modal');
    if (modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = 'auto';
        // Clear modal content
        const modalContent = document.getElementById('modal-content');
        if (modalContent) {
            modalContent.innerHTML = '';
        }
        // Reset modal position
        const modalWindow = document.getElementById('modal-window');
        if (modalWindow) {
            modalWindow.style.transform = '';
        }
    }
}

// Drag functionality for modal
function initializeDragFunctionality() {
    const modalHeader = document.getElementById('modal-header');
    const modalWindow = document.getElementById('modal-window');
    
    if (!modalHeader || !modalWindow) return;
    
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;
    
    modalHeader.addEventListener('mousedown', (e: MouseEvent) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        // Get current transform values
        const transform = modalWindow.style.transform;
        const matrix = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
        if (matrix) {
            initialX = parseFloat(matrix[1]) || 0;
            initialY = parseFloat(matrix[2]) || 0;
        } else {
            initialX = 0;
            initialY = 0;
        }
        
        modalHeader.style.cursor = 'grabbing';
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e: MouseEvent) => {
        if (!isDragging) return;
        
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        const newX = initialX + deltaX;
        const newY = initialY + deltaY;
        
        modalWindow.style.transform = `translate(${newX}px, ${newY}px)`;
    });
    
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            modalHeader.style.cursor = 'move';
        }
    });
}

// Add close button event listener
document.addEventListener('DOMContentLoaded', () => {
    const closeButton = document.getElementById('close-modal');
    if (closeButton) {
        closeButton.addEventListener('click', closeModal);
    }
    
    // Close modal when clicking outside the content
    const modal = document.getElementById('chart-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
    }
});

// Function to create full-screen time series chart (stacked bar chart)
function createFullScreenTimeSeriesChart(timeSeriesChartData: any[], countryName: string, globalColorScale: any) {
    const modalContent = document.getElementById('modal-content');
    const modalTitle = document.getElementById('modal-title');
    if (!modalContent) return;

    // Set modal title
    if (modalTitle) {
        modalTitle.textContent = `Policy Evolution Over Time - ${countryName}`;
    }

    modalContent.innerHTML = `
        <div id="fullscreen-timeseries-chart" class="w-full h-full"></div>
    `;

    // Add a small delay to ensure the modal is fully rendered
    setTimeout(() => {
        const container = document.getElementById('fullscreen-timeseries-chart');
        if (!container) return;
        // Allow positioned overlays inside the container
        (container as HTMLElement).style.position = 'relative';

        const containerRect = container.getBoundingClientRect();
        // Responsive margins for smaller screens
        const isSmallScreen = containerRect.width < 768;
        const margin = isSmallScreen 
            ? { top: 30, right: 60, bottom: 60, left: 120 }
            : { top: 40, right: 80, bottom: 80, left: 140 };
        const width = containerRect.width - margin.left - margin.right;
        const extraSpace = isSmallScreen ? 60 : 100;
        const height = containerRect.height - margin.top - margin.bottom - extraSpace;

        // Collect measures and years; build presence matrix
        const measures = new Set<string>();
        const years = new Set<number>();
        timeSeriesChartData.forEach(measureData => {
            measures.add(measureData.measure);
            measureData.values.forEach((v: any) => years.add(Number(v.year)));
        });

        const sortedYears = Array.from(years).sort((a, b) => a - b);
        const allPolicyTypes = Array.from(measures);
        const yearlyData: { [year: number]: { [measure: string]: number } } = {};
        sortedYears.forEach(year => { yearlyData[year] = {}; });
        sortedYears.forEach(year => {
            timeSeriesChartData.forEach(measureData => {
                const yearData = measureData.values.find((v: any) => Number(v.year) === year);
                if (yearData && Number(yearData.count) > 0) {
                    yearlyData[year][measureData.measure] = 1;
                }
            });
        });

        // Compute frequency per policy type and sort ascending (least at top, most at bottom)
        const frequencyByMeasure: { [m: string]: number } = {};
        allPolicyTypes.forEach(m => {
            frequencyByMeasure[m] = sortedYears.reduce((acc, y) => acc + (yearlyData[y][m] ? 1 : 0), 0);
        });
        const sortedPolicyTypes = allPolicyTypes.slice().sort((a, b) => frequencyByMeasure[a] - frequencyByMeasure[b]);

        const svgHeightOffset = isSmallScreen ? 30 : 50;
        const svg = d3.select(container)
            .append('svg')
            .attr('width', containerRect.width)
            .attr('height', containerRect.height - svgHeightOffset);
        addLogoWatermark(svg as any, containerRect.width);

        const g = svg.append('g')
            .attr('transform', `translate(${margin.left}, ${margin.top})`);

        // Scales: x years, y policy types as rows
        const xScale = d3.scaleBand()
            .domain(sortedYears.map(String))
            .range([0, width])
            .padding(0.05);

        const yBand = d3.scaleBand()
            .domain(sortedPolicyTypes)
            .range([0, height])
            .padding(0.1);

        // Add axes with adaptive tick density for readability
        const axisFontSize = isSmallScreen ? '11px' : '14px';
        const xDomainFS = xScale.domain();
        const stepFS = xDomainFS.length > 24 ? 3 : (xDomainFS.length > 14 ? 2 : 1);
        const xTicksFS = xDomainFS.filter((_, i) => i % stepFS === 0);
        const xAxisFS = g.append('g')
            .attr('transform', `translate(0,${height})`)
            .call(d3.axisBottom(xScale).tickValues(xTicksFS))
            .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif');
        xAxisFS.selectAll('text')
            .style('font-size', axisFontSize)
            .style('text-anchor', 'middle')
            .attr('dx', '0')
            .attr('dy', '0');
        const yAxisFS = g.append('g').call(d3.axisLeft(yBand));
        yAxisFS.selectAll('text').style('font-size', axisFontSize);
        xAxisFS.select('.domain').style('stroke', '#e2e8f0').style('stroke-width', 1);
        yAxisFS.select('.domain').style('stroke', '#e2e8f0').style('stroke-width', 1);

        // Build cell data: one rect per active policy in that year
        const cells: { year: number; measure: string }[] = [];
        sortedYears.forEach(year => {
            sortedPolicyTypes.forEach(measure => {
                if (yearlyData[year][measure]) {
                    cells.push({ year, measure });
                }
            });
        });

        // Draw rows of cells (non-stacked)
        g.selectAll('.policy-cell')
            .data(cells)
            .enter()
            .append('rect')
            .attr('class', 'policy-cell')
            .attr('x', d => xScale(String(d.year)) || 0)
            .attr('y', d => yBand(d.measure) || 0)
            .attr('width', xScale.bandwidth())
            .attr('height', yBand.bandwidth())
            .attr('rx', 4)
            .attr('ry', 4)
            .attr('fill', d => globalColorScale(d.measure) as string)
            .style('opacity', 0.95)
            .style('cursor', 'pointer')
            .style('stroke', 'rgba(255,255,255,0.6)')
            .style('stroke-width', 1)
            .on('mouseover', function() {
                d3.select(this)
                    .style('opacity', 1)
                    .style('stroke', 'rgba(17, 24, 39, 0.5)')
                    .style('stroke-width', 1.5)
                    .style('filter', 'saturate(1.6) contrast(1.15)');
            })
            .on('mouseout', function() {
                d3.select(this)
                    .style('opacity', 0.95)
                    .style('stroke', 'rgba(255,255,255,0.6)')
                    .style('stroke-width', 1)
                    .style('filter', 'none');
            });

        // Grid lines: horizontal by policy row, vertical by year
        const grid = g.append('g').attr('class','grid');
        grid.selectAll('.hline')
            .data(sortedPolicyTypes)
            .enter().append('line')
            .attr('class','hline')
            .attr('x1', 0)
            .attr('x2', width)
            .attr('y1', d => (yBand(d) || 0) + yBand.bandwidth())
            .attr('y2', d => (yBand(d) || 0) + yBand.bandwidth())
            .style('stroke', '#e2e8f0')
            .style('stroke-dasharray', '2,2')
            .style('opacity', 0.2);
        grid.selectAll('.vline')
            .data(sortedYears)
            .enter().append('line')
            .attr('class','vline')
            .attr('y1', 0)
            .attr('y2', height)
            .attr('x1', d => (xScale(String(d)) || 0) + xScale.bandwidth())
            .attr('x2', d => (xScale(String(d)) || 0) + xScale.bandwidth())
            .style('stroke', '#e2e8f0')
            .style('stroke-dasharray', '2,2')
            .style('opacity', 0.08);

        // No legend needed; y-axis labels identify policy rows

        // Add axis labels
        const axisLabelFontSize = isSmallScreen ? '12px' : '16px';
        const axisLabelBottomOffset = isSmallScreen ? 15 : 20;
        
        // Removed vertical y-axis label to declutter the chart

        g.append('text')
            .attr('transform', `translate(${width / 2}, ${height + margin.bottom - axisLabelBottomOffset})`)
            .style('text-anchor', 'middle')
            .style('font-size', axisLabelFontSize)
            .style('font-weight', 'bold')
            .text('Year');
        
        // Interaction hint overlay for discoverability
        const hint = d3.select(container)
            .append('div')
            .attr('class', 'chart-interaction-hint')
            .style('position', 'absolute')
            .style('top', '12px')
            .style('left', '12px')
            .style('z-index', '50')
            .style('padding', '8px 12px')
            .style('border-radius', '8px')
            .style('background', 'rgba(31,41,55,0.9)')
            .style('color', '#fff')
            .style('font-size', '12px')
            .style('box-shadow', '0 4px 10px rgba(0,0,0,0.15)')
            .style('transition', 'opacity 300ms ease')
            .style('opacity', '0.95')
            .text('Tip: Hover over bars or click for details.');

        const hideHint = () => {
            hint.style('opacity', '0');
            setTimeout(() => hint.remove(), 350);
        };
        setTimeout(hideHint, 4500);
        (container as HTMLElement).addEventListener('mouseenter', hideHint, { once: true });
    }, 100); // 100ms delay to ensure modal is rendered
}

const countryCodeMapping: { [key: string]: string } = {
    "AFG": "AF", "AGO": "AO", "ALB": "AL", "ARE": "AE", "ARG": "AR",
    "ARM": "AM", "ATA": "AQ", "ATF": "TF", "AUS": "AU", "AUT": "AT",
    "AZE": "AZ", "BDI": "BI", "BEL": "BE", "BEN": "BJ", "BFA": "BF",
    "BGD": "BD", "BGR": "BG", "BHS": "BS", "BIH": "BA", "BLR": "BY",
    "BLZ": "BZ", "BOL": "BO", "BRA": "BR", "BRN": "BN", "BTN": "BT",
    "BWA": "BW", "CAF": "CF", "CAN": "CA", "CHE": "CH", "CHL": "CL",
    "CHN": "CN", "CIV": "CI", "CMR": "CM", "COD": "CD", "COG": "CG",
    "COL": "CO", "CRI": "CR", "CUB": "CU", /* N. Cyprus */ "-99": "CY",
    "CYP": "CY", "CZE": "CZ", "DEU": "DE", "DJI": "DJ", "DNK": "DK",
    "DOM": "DO", "DZA": "DZ", "ECU": "EC", "EGY": "EG", "ERI": "ER",
    "ESP": "ES", "EST": "EE", "ETH": "ET", "FIN": "FI", "FJI": "FJ",
    "FLK": "FK", "FRA": "FR", "GAB": "GA", "GBR": "GB", "GEO": "GE",
    "GHA": "GH", "GIN": "GN", "GMB": "GM", "GNB": "GW", "GNQ": "GQ",
    "GRC": "GR", "GTM": "GT", "GUY": "GY", "HND": "HN", "HRV": "HR",
    "HTI": "HT", "HUN": "HU", "IDN": "ID", "IND": "IN", "IRL": "IE",
    "IRN": "IR", "IRQ": "IQ", "ISL": "IS", "ISR": "IL", "ITA": "IT",
    "JAM": "JM", "JOR": "JO", "JPN": "JP", "KAZ": "KZ", "KEN": "KE",
    "KGZ": "KG", "KHM": "KH", "KOR": "KR", "KWT": "KW", "LAO": "LA",
    "LBN": "LB", "LBR": "LR", "LBY": "LY", "LKA": "LK", "LSO": "LS",
    "LTU": "LT", "LUX": "LU", "LVA": "LV", "MAR": "MA", "MDA": "MD",
    "MDG": "MG", "MEX": "MX", "MKD": "MK", "MLI": "ML", "MMR": "MM",
    "MNE": "ME", "MNG": "MN", "MOZ": "MZ", "MRT": "MR", "MWI": "MW",
    "MYS": "MY", "NAM": "NA", "NCL": "NC", "NER": "NE", "NGA": "NG",
    "NIC": "NI", "NLD": "NL", "NOR": "NO", "NPL": "NP", "NZL": "NZ",
    "OMN": "OM", "PAK": "PK", "PAN": "PA", "PER": "PE", "PHL": "PH",
    "PNG": "PG", "POL": "PL", "PRI": "PR", "PRK": "KP", "PRT": "PT",
    "PRY": "PY", "QAT": "QA", "ROU": "RO", "RUS": "RU", "RWA": "RW",
    "ESH": "EH", "SAU": "SA", "SDN": "SD", "SSD": "SS", "SEN": "SN",
    "SLB": "SB", "SLE": "SL", "SLV": "SV", "SOM": "SO", "SRB": "RS",
    "SUR": "SR", "SVK": "SK", "SVN": "SI", "SWE": "SE", "SWZ": "SZ",
    "SYR": "SY", "TCD": "TD", "TGO": "TG", "THA": "TH", "TJK": "TJ",
    "TKM": "TM", "TLS": "TL", "TTO": "TT", "TUN": "TN", "TUR": "TR",
    "TWN": "TW", "TZA": "TZ", "UGA": "UG", "UKR": "UA", "URY": "UY",
    "USA": "US", "UZB": "UZ", "VEN": "VE", "VNM": "VN", "VUT": "VU",
    "YEM": "YE", "ZAF": "ZA", "ZMB": "ZM", "ZWE": "ZW"
};

// Set dimensions for the map
const width = 1200;
const height = 700;

const svg = d3.select("#world-map")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

const g = svg.append("g");

const projection = geoMercator()
    .scale(150)
    .translate([width / 2, height / 1.6]);

const path = geoPath().projection(projection);

const tooltip = d3.select("body").append("div")
    .attr("class", "tooltip")
    .style("position", "absolute")
    .style("z-index", "10")
    .style("visibility", "hidden")
    .style("background", "rgba(255,255,255,0.8)")
    .style("border", "1px solid #ccc")
    .style("padding", "10px")
    .style("border-radius", "5px")
    .style("font-family", "sans-serif")
    .style("font-size", "14px");

const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .translateExtent([[-500, -500], [width + 500, height + 500]])
    .on('zoom', (event) => {
        g.attr('transform', event.transform);
    });

svg.call(zoom as any);

const countryCode2to3 = Object.fromEntries(Object.entries(countryCodeMapping).map(([k, v]) => [v, k]));

const baseUrl = (import.meta as any).env.BASE_URL || '/';

const policyDataUrl = `${baseUrl}data/policy_data.xlsx`;
const targetsDataUrl = `${baseUrl}data/targets_data.csv`;
const climateTargetsDataUrl = `${baseUrl}data/climate_targets_data.csv`;
const evDataUrl = `${baseUrl}data/ev_data.xlsx`;

const CITATION_POLICY = "Weko, S., Bold, F., Chaianong, A., Günkördü, D., Lebedeva, D., Malhotra, P., Milioritsas, I., Weiß, J., and Lilliestam, J. (2026): Data on policy support for renewable electricity (Version 1, January 2026). Friedrich-Alexander-Universität Erlangen-Nürnberg. DOI: 10.5281/zenodo.18327812";
const CITATION_TARGETS = "Chaianong, A., Malhotra P., Milioritsas, I., Weko, S., and Lilliestam, J. (2025): Data on renewable electricity targets (Version 1, February 2025). Sustainability Transition Policy Group, Friedrich-Alexander-Universität Erlangen-Nürnberg. DOI: 10.5281/zenodo.15476149.";
const CITATION_CLIMATE = "Chaianong, A., Malhotra P., Milioritsas, I., Weko, S., and Lilliestam, J. (2025): Data on climate targets (Version 1, February 2025). Sustainability Transition Policy Group, Friedrich-Alexander-Universität Erlangen-Nürnberg. DOI: 10.5281/zenodo.15476049.";
const CITATION_EV = "Weko, S., Bold, F., Chaianong, A., Günkördü, D., Lebedeva, D., Malhotra, P., Milioritsas, I., Weiß, J., and Lilliestam, J. (2026): Data on policy support for electric vehicles (Version 1, January 2026). Friedrich-Alexander-Universität Erlangen-Nürnberg. DOI: 10.5281/zenodo.18328109.";

// Global variables to store all data
type MapType = 'policies' | 'ev' | 'targets' | 'climateTargets' | 'regulations';
let currentMapType: MapType = 'policies';
 let currentTargetType: RenewableTargetType = 'Electricity'; // Default target type
let currentRegulationsSection: 'buildCodes' | 'buildableLand' = 'buildCodes';
 // Year-group filter for targets view (default to 'latest')
 let currentTargetYearGroup: '2020' | '2030' | '2050' | 'latest' = 'latest';
 // Filter mode: always use year-group filtering (no UI toggle)
 let currentTargetFilterMode: 'all' | 'group' = 'group';
 // Year-group filter for climate targets view (default to 'latest')
 let currentClimateTargetYearGroup: '2020' | '2030' | '2050' | 'latest' = 'latest';
 
 // Helper to map a target year to a year group
 function getYearGroup(year: number): '2020' | '2030' | '2050' | null {
     if (!Number.isFinite(year)) return null;
     // Groups as described: 
     // 2020: targets until 2020 plus 5 years => <= 2025
     // 2030: 2025 to 2035 (inclusive overlap at boundaries)
    // 2050: 2035 and beyond (to infinity)
     if (year <= 2025) return '2020';
     if (year >= 2025 && year <= 2035) return '2030';
    if (year >= 2035) return '2050'; // Changed: now includes all years >= 2035
     return null;
 }
let allData: any = {};

// Flag to track if submenu has been initialized
let submenuInitialized = false;

// Global reference to updateMap function
let updateMapFunction: (() => void) | null = null;

// ---- Renewable targets: explicitly supported types (UI + processing) ----
// We intentionally restrict the "Renewable targets" map to supported percent-based types.
// If the sheet includes additional target types like Primary energy, they are ignored.
type RenewableTargetType = 'Electricity' | 'Final energy';
const ENABLED_RENEWABLE_TARGET_TYPES = new Set<RenewableTargetType>([
    'Electricity',
    'Final energy',
]);
const RENEWABLE_TARGET_COLOR_MAX = 100;

function canonicalRenewableTargetType(raw: any): RenewableTargetType | null {
    const t = String(raw ?? '').trim();
    if (!t) return null;
    const lower = t.toLowerCase();
    if (lower === 'electricity') return 'Electricity';
    if (lower === 'final energy') return 'Final energy';
    return null;
}

// ---- EU-only guard for climate targets ----
// Climate targets remain EU-only. Renewable targets are global.
const EU_COUNTRY_CODES_3 = new Set([
    'AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA',
    'DEU', 'GRC', 'HUN', 'IRL', 'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD',
    'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE'
]);

// Function to map target type names to user-friendly display names
function getTargetTypeDisplayName(targetType: string): string {
    // Normalize the target type for comparison
    const normalizedType = targetType.trim();
    
    const displayNameMap: { [key: string]: string } = {
        'Electricity': 'Renewable Electricity Target',
        'electricity': 'Renewable Electricity Target',
        'Final energy': 'Renewable Final Energy Target',
        'final energy': 'Renewable Final Energy Target',
    };
    
    return displayNameMap[normalizedType] || targetType;
}

// Function to initialize targets submenu
function initializeTargetsSubmenu() {
    const submenuOptions = document.getElementById('submenuOptions');
    const submenu = document.getElementById('targetsSubmenu');
    const submenuClose = document.getElementById('submenuClose');
    const yearGroupOptions = document.getElementById('yearGroupOptions');
    const yearGroupWrapper = document.getElementById('yearGroupWrapper');
    const filterModeOptions = document.getElementById('filterModeOptions');
    
    if (!submenuOptions || !submenu || !submenuClose) return;
    
    // Get available target types
    const targetTypes = allData.targets.allTargetTypes || [];
    console.log('Initializing submenu with target types:', targetTypes);
    
    // Only initialize if not already done or if target types have changed
    if (!submenuInitialized || submenuOptions.children.length !== targetTypes.length) {
        // Clear existing options
        submenuOptions.innerHTML = '';
        
        // Filter mode UI removed; always show year-group controls
        if (yearGroupWrapper) yearGroupWrapper.classList.remove('hidden');
        
        // Initialize year-group options once
        if (yearGroupOptions && yearGroupOptions.children.length === 0) {
            const groups: Array<'2020' | '2030' | '2050' | 'latest'> = ['latest', '2020', '2030', '2050'];
            groups.forEach(group => {
                const btn = document.createElement('button');
                btn.className = 'year-option';
                btn.textContent = group === 'latest' ? 'Latest Target' : group;
                if (group === currentTargetYearGroup) btn.classList.add('active');
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    currentTargetYearGroup = group;
                    // Update active state
                    yearGroupOptions.querySelectorAll('.year-option').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    // Refresh map
                    if (updateMapFunction) updateMapFunction();
                });
                yearGroupOptions.appendChild(btn);
            });
        }
        
        // Create submenu options for each target type
        targetTypes.forEach((targetType: string) => {
            const option = document.createElement('button');
            option.className = 'submenu-option';
            const displayName = getTargetTypeDisplayName(targetType);
            console.log(`Target type "${targetType}" → Display name "${displayName}"`);
            
            // Add explanation for specific target types
            let explanation = '';
            const normalizedType = targetType.trim().toLowerCase();
            if (normalizedType === 'electricity') {
                explanation = '<br><span style="font-size: 0.75em; opacity: 0.8; font-weight: normal;">% of renewable electricity in a power system generation</span>';
            } else if (normalizedType === 'final energy') {
                explanation = '<br><span style="font-size: 0.75em; opacity: 0.8; font-weight: normal;">% of renewable energy in final energy consumption</span>';
            }

            option.innerHTML = `${displayName}${explanation}`;
            option.dataset.targetType = targetType;
            
            // Set active state for current target type
            if (targetType === currentTargetType) {
                option.classList.add('active');
            }
            
            // Add click event listener
             option.addEventListener('click', (e) => {
                 e.preventDefault();
                 e.stopPropagation();
                 console.log('Target type clicked:', targetType);
                 
                 // Update current target type and map type
                 currentTargetType = targetType as RenewableTargetType;
                 currentMapType = 'targets';
                 
                 console.log('Updated currentTargetType to:', currentTargetType);
                 
                 // Update active state
                 submenuOptions.querySelectorAll('.submenu-option').forEach(opt => {
                     opt.classList.remove('active');
                 });
                 option.classList.add('active');
                 
                 // Update map with new target type
                  console.log('Calling updateMap for target type:', targetType);
                  if (updateMapFunction) {
                      updateMapFunction();
                  } else {
                      console.error('updateMap function not available yet');
                  }
                 
                 // Don't hide submenu immediately - let user see the change and potentially select other types
                 // hideTargetsSubmenu();
             });
            
            submenuOptions.appendChild(option);
        });
        
        // Add close button event listener (only once)
        if (!submenuInitialized) {
            submenuClose.addEventListener('click', hideTargetsSubmenu);
        }
        
        submenuInitialized = true;
    } else {
        // Just update active states if submenu already exists
        submenuOptions.querySelectorAll('.submenu-option').forEach(opt => {
            opt.classList.remove('active');
            const optElement = opt as HTMLElement;
            if (optElement.dataset.targetType === currentTargetType) {
                opt.classList.add('active');
            }
        });
    }
}

// Function to show targets submenu
function showTargetsSubmenu() {
    // Initialize submenu first to populate target types
    initializeTargetsSubmenu();
    
    const submenu = document.getElementById('targetsSubmenu');
    if (submenu) {
        submenu.classList.add('visible');
    }
}

// Function to hide targets submenu
function hideTargetsSubmenu() {
    const submenu = document.getElementById('targetsSubmenu');
    if (submenu) {
        submenu.classList.remove('visible');
    }
}

// Function to initialize climate targets submenu
let climateSubmenuInitialized = false;

function initializeClimateTargetsSubmenu() {
    const climateYearGroupOptions = document.getElementById('climateYearGroupOptions');
    const climateSubmenu = document.getElementById('climateTargetsSubmenu');
    const climateSubmenuClose = document.getElementById('climateSubmenuClose');
    const climateYearGroupWrapper = document.getElementById('climateYearGroupWrapper');
    
    if (!climateYearGroupOptions || !climateSubmenu || !climateSubmenuClose) return;
    
    console.log('Initializing climate targets submenu');
    
    // Only initialize if not already done
    if (!climateSubmenuInitialized) {
        // Always show year-group controls
        if (climateYearGroupWrapper) climateYearGroupWrapper.classList.remove('hidden');
        
        // Initialize year-group options
        if (climateYearGroupOptions && climateYearGroupOptions.children.length === 0) {
            const groups: Array<'2020' | '2030' | '2050' | 'latest'> = ['latest', '2020', '2030', '2050'];
            groups.forEach(group => {
                const btn = document.createElement('button');
                btn.className = 'year-option';
                btn.textContent = group === 'latest' ? 'Latest Target' : group;
                if (group === currentClimateTargetYearGroup) btn.classList.add('active');
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    currentClimateTargetYearGroup = group;
                    // Update active state
                    climateYearGroupOptions.querySelectorAll('.year-option').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    // Refresh map
                    if (updateMapFunction) updateMapFunction();
                });
                climateYearGroupOptions.appendChild(btn);
            });
        }
        
        // Add close button event listener (only once)
        if (!climateSubmenuInitialized) {
            climateSubmenuClose.addEventListener('click', hideClimateTargetsSubmenu);
        }
        
        climateSubmenuInitialized = true;
    }
}

// Function to show climate targets submenu
function showClimateTargetsSubmenu() {
    // Initialize submenu first
    initializeClimateTargetsSubmenu();
    
    const submenu = document.getElementById('climateTargetsSubmenu');
    if (submenu) {
        submenu.classList.add('visible');
    }
}

// Function to hide climate targets submenu
function hideClimateTargetsSubmenu() {
    const submenu = document.getElementById('climateTargetsSubmenu');
    if (submenu) {
        submenu.classList.remove('visible');
    }
}

function showRegulationsSubmenu() {
    const submenu = document.getElementById('regulationsSubmenu');
    if (submenu) {
        submenu.classList.add('visible');
    }
}

function hideRegulationsSubmenu() {
    const submenu = document.getElementById('regulationsSubmenu');
    if (submenu) {
        submenu.classList.remove('visible');
    }
}

function setRegulationsSection(section: 'buildCodes' | 'buildableLand') {
    currentRegulationsSection = section;
    const buildCodesView = document.getElementById('build-codes-view');
    const buildableView = document.getElementById('buildable-land-view');
    const buildCodesHelp = document.getElementById('bc-buildcodes-help');
    const buildableHelp = document.getElementById('bc-buildable-help');
    const buildCodesButton = document.getElementById('showBuildCodesRegulations');
    const buildableButton = document.getElementById('showBuildableLandRegulations');

    buildCodesButton?.classList.toggle('active', section === 'buildCodes');
    buildableButton?.classList.toggle('active', section === 'buildableLand');
    buildCodesView?.classList.toggle('hidden', section !== 'buildCodes');
    buildableView?.classList.toggle('hidden', section !== 'buildableLand');
    buildCodesHelp?.classList.toggle('hidden', section !== 'buildCodes');
    buildableHelp?.classList.toggle('hidden', section !== 'buildableLand');

    if (section === 'buildCodes') {
        document.dispatchEvent(new CustomEvent('build-codes:show'));
    } else {
        document.dispatchEvent(new CustomEvent('buildable-land:show'));
    }
}

function setRegulationsVisible(visible: boolean) {
    const mapSvg = document.getElementById('world-map');
    const regulationsContent = document.getElementById('regulations-content');
    const worldHelp = document.getElementById('bc-worldmap-help');
    const buildCodesHelp = document.getElementById('bc-buildcodes-help');
    const buildableHelp = document.getElementById('bc-buildable-help');

    mapSvg?.classList.toggle('regulations-hidden', visible);
    regulationsContent?.classList.toggle('visible', visible);
    worldHelp?.classList.toggle('hidden', visible);

    if (visible) {
        setRegulationsSection(currentRegulationsSection);
    } else {
        buildCodesHelp?.classList.add('hidden');
        buildableHelp?.classList.add('hidden');
    }
}

// Loading indicator functions
function showLoadingIndicator() {
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) {
        loadingMessage.classList.add('visible');
    }
}

function hideLoadingIndicator() {
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) {
        loadingMessage.classList.remove('visible');
    }
}

// Register the main world-map download menu after data loads (see below).

showLoadingIndicator();

Promise.all([
    d3.json(`${baseUrl}world.geojson`),
    fetch(policyDataUrl)
        .then(r => {
            if (!r.ok) throw new Error(`Failed to fetch policy data: ${r.statusText}`);
            return r.arrayBuffer();
        })
        .then(ab => {
            try {
                console.log("Parsing policy data with XLSX...");
                const wb = XLSX.read(ab, { type: 'array' });
                const firstSheetName = wb.SheetNames[0];
                const ws = wb.Sheets[firstSheetName];
                // Use sheet_to_csv to handle conversions (handles quotes, commas etc.)
                const csvText = XLSX.utils.sheet_to_csv(ws);
                console.log("Converted policy sheet to CSV text, length:", csvText.length);
                const parsed = d3.csvParse(csvText);
                console.log("Parsed policy data rows:", parsed.length);
                return parsed;
            } catch (e) {
                console.error("Error parsing policy XLSX:", e);
                return []; // Return empty array on failure to avoid crashing Promise.all
            }
        }),
    d3.csv(targetsDataUrl),
    d3.csv(climateTargetsDataUrl),
    fetch(evDataUrl)
        .then(r => {
            if (!r.ok) throw new Error(`Failed to fetch EV data: ${r.statusText}`);
            return r.arrayBuffer();
        })
        .then(ab => {
            try {
                console.log("Parsing EV data with XLSX...");
                const wb = XLSX.read(ab, { type: 'array' });
                // Use the second sheet (data sheet), skip the first "About" sheet
                const dataSheetName = wb.SheetNames.length > 1 ? wb.SheetNames[1] : wb.SheetNames[0];
                console.log("Using EV sheet:", dataSheetName);
                const ws = wb.Sheets[dataSheetName];
                const csvText = XLSX.utils.sheet_to_csv(ws);
                console.log("Converted EV sheet to CSV text, length:", csvText.length);
                return d3.csvParse(csvText);
            } catch (e) {
                console.error("Error parsing EV XLSX:", e);
                return [];
            }
        })
        .catch(e => {
            console.error("Error fetching EV data:", e);
            return [];
        })
]).then(([geoData, policyCsv, targetsCsv, climateTargetsCsv, evCsv]: [any, any, any, any, any]) => {
    console.log('Data loaded successfully:');
    console.log('Policy CSV rows:', policyCsv.length);
    console.log('Targets CSV rows:', targetsCsv.length);
    console.log('Climate Targets CSV rows:', climateTargetsCsv.length);
    console.log('EV CSV rows:', evCsv.length);
    console.log('First few targets rows:', targetsCsv.slice(0, 3));
    console.log('First few climate targets rows:', climateTargetsCsv.slice(0, 3));
    console.log('First few EV rows:', evCsv.slice(0, 3));
    
    // If targets CSV is empty or malformed, use sample data
    if (!targetsCsv || targetsCsv.length === 0 || !targetsCsv[0] || Object.keys(targetsCsv[0]).length < 5) {
        console.log('Targets CSV appears to be empty or malformed, using sample data');
        targetsCsv = [
            { 'Country': 'DEU', 'A': 'DEU', 'F': '2021-06-01', 'H': '2030', 'K': '65' },
            { 'Country': 'FRA', 'A': 'FRA', 'F': '2020-04-15', 'H': '2030', 'K': '40' },
            { 'Country': 'ESP', 'A': 'ESP', 'F': '2021-03-20', 'H': '2030', 'K': '42' },
            { 'Country': 'ITA', 'A': 'ITA', 'F': '2020-12-10', 'H': '2030', 'K': '30' },
            { 'Country': 'GBR', 'A': 'GBR', 'F': '2021-04-22', 'H': '2030', 'K': '40' },
            { 'Country': 'NLD', 'A': 'NLD', 'F': '2019-06-28', 'H': '2030', 'K': '70' },
            { 'Country': 'DNK', 'A': 'DNK', 'F': '2020-06-25', 'H': '2030', 'K': '50' },
            { 'Country': 'SWE', 'A': 'SWE', 'F': '2017-06-15', 'H': '2030', 'K': '100' },
            { 'Country': 'NOR', 'A': 'NOR', 'F': '2016-06-11', 'H': '2030', 'K': '67.5' },
            { 'Country': 'USA', 'A': 'USA', 'F': '2021-04-22', 'H': '2030', 'K': '50' },
            { 'Country': 'CAN', 'A': 'CAN', 'F': '2020-12-11', 'H': '2030', 'K': '90' },
            { 'Country': 'JPN', 'A': 'JPN', 'F': '2020-10-26', 'H': '2030', 'K': '36-38' },
            { 'Country': 'AUS', 'A': 'AUS', 'F': '2021-10-26', 'H': '2030', 'K': '43' },
            { 'Country': 'BRA', 'A': 'BRA', 'F': '2021-04-22', 'H': '2030', 'K': '45' },
            { 'Country': 'IND', 'A': 'IND', 'F': '2021-11-01', 'H': '2030', 'K': '50' },
            { 'Country': 'CHN', 'A': 'CHN', 'F': '2020-09-22', 'H': '2030', 'K': '25' }
        ];
    } else {
        console.log('Successfully loaded targets CSV with', targetsCsv.length, 'rows');
        console.log('First row keys:', Object.keys(targetsCsv[0]));
        console.log('First few rows:', targetsCsv.slice(0, 3));
    }

    console.log("D3 detected columns:", policyCsv.columns);

    // Determine the policy_changed_detail column (case-insensitive). Fallback to 'policy_changed'.
    const policyChangedDetailColumnName = (() => {
        const cols = policyCsv.columns || [];
        const byDetail = cols.find((n: string) => n && ['policy_changed_detail', 'status', 'change_detail'].includes(n.trim().toLowerCase()));
        if (byDetail) return byDetail;
        const byChanged = cols.find((n: string) => n && n.trim().toLowerCase() === 'policy_changed');
        return byChanged || null;
    })();

    // Dynamic column detection for other key fields with expanded search terms
    const countryColumnName = (policyCsv.columns || []).find((n: string) => n && ['country', 'nation', 'member state', 'iso', 'code', 'country_code'].includes(n.trim().toLowerCase())) || 'country';
    const measureColumnName = (policyCsv.columns || []).find((n: string) => n && ['measure', 'policy type', 'type', 'sector', 'policy_type'].includes(n.trim().toLowerCase())) || 'measure';
    const techTypeColumnName = (policyCsv.columns || []).find((n: string) => n && ['technology_type', 'technology', 'tech', 'source'].includes(n.trim().toLowerCase())) || 'Technology_type';
    const yearColumnName = (policyCsv.columns || []).find((n: string) => n && ['year', 'date', 'start year', 'start_year', 'implementation year'].includes(n.trim().toLowerCase())) || 'year';

    console.log('Resolved column names:', {
        policyChangedDetail: policyChangedDetailColumnName,
        country: countryColumnName,
        measure: measureColumnName,
        techType: techTypeColumnName,
        year: yearColumnName
    });

    function isIntroduced(row: any): boolean {
        if (!policyChangedDetailColumnName) {
            // If we cannot locate the policy_changed_detail column, skip counting
            return false;
        }
        const raw = row[policyChangedDetailColumnName];
        if (raw == null) return false;
        const v = String(raw).trim().toLowerCase();
        return v === 'introduced';
    }

    const countryNameMap = geoData.features.reduce((acc: { [key: string]: string }, feature: any) => {
        acc[feature.properties.name] = feature.id;
        return acc;
    }, {});

    // Policy CSV uses free-text country names; GeoJSON uses its own naming.
    // Add aliases so data still attaches to the correct country.
    const POLICY_COUNTRY_NAME_ALIASES: Record<string, string> = {
        // GeoJSON uses "Czech Republic"
        'czechia': 'Czech Republic',
        // GeoJSON uses "England" for UK
        'united kingdom of great britain and northern ireland': 'England',
        'united kingdom': 'England'
    };

    function normalizePolicyCountryName(raw: any): string | null {
        if (raw == null) return null;
        const name = String(raw).trim();
        if (!name) return null;
        const aliased = POLICY_COUNTRY_NAME_ALIASES[name.toLowerCase()];
        return aliased || name;
    }

    // Collect all unique policy types (measures) and technology types for consistent color mapping
    const policyTypesSet = new Set<string>();
    const technologyTypesSet = new Set<string>();
    policyCsv.forEach((row: any) => {
        const measure = row[measureColumnName] ? String(row[measureColumnName]) : 'Unknown';
        policyTypesSet.add(measure);
        const tech = row[techTypeColumnName] ? String(row[techTypeColumnName]) : 'Unknown';
        technologyTypesSet.add(tech);
    });
    const allPolicyTypes = Array.from(policyTypesSet).sort();
    const allTechnologyTypes = Array.from(technologyTypesSet).sort();
    
    // Create global color mapping for policy types
    // Muted, desaturated palette (no pure black). Designed for a calm, standardized look.
    const mutedPalette = [
            '#8fb9e0', // soft blue
            '#f4b37d', // muted orange
            '#9fd18b', // soft green
            '#e79aa0', // muted coral
            '#b7a6d9', // soft purple
            '#c7a58a', // muted tan
            '#e6a9c8', // soft pink
            '#9bb8bf', // slate teal
            '#c9c97a', // muted olive
            '#86cdd3', // soft cyan
            '#b9d7ef', // light blue
            '#f7cfa2', // light orange
            '#cfe8b9', // light green
            '#e8b9bd', // light red
            '#d6c3e9', // light purple
            '#b8c6da'  // blue-gray
        ];
    const globalColorScale = d3.scaleOrdinal()
        .domain(allPolicyTypes)
        .range(mutedPalette);
    const globalTechColorScale = d3.scaleOrdinal()
        .domain(allTechnologyTypes)
        .range(mutedPalette);

    // Helper: consistent color for measures (policy types), with override for tender/auction
    function getMeasureColor(measure: string): string {
        const m = String(measure || 'Unknown');
        const ml = m.toLowerCase();
        // Compute a dark blue that keeps the palette's saturation
        const ref = d3.hsl('#8fb9e0');
        const tenderBlue = d3.hsl(220, ref.s, Math.max(0, ref.l - 0.25)).toString();
        if (ml.includes('tender') || ml.includes('auction')) return tenderBlue;
        return (globalColorScale(m) as string) || '#8fb9e0';
    }
    
    // Process policy data to count total policies per country
    const policyData = policyCsv.reduce((acc: { [key: string]: number }, row: any) => {
        // Only count policies with Status === 'introduced'
        if (!isIntroduced(row)) return acc;
        const countryName = normalizePolicyCountryName(row[countryColumnName]);
        if (countryName) {
            const countryCode3 = countryNameMap[countryName];
            if (countryCode3) {
                if (!acc[countryCode3]) {
                    acc[countryCode3] = 0;
                }
                acc[countryCode3]++;
            } else {
                // console.warn(`No country code found for: ${countryName}`);
            }
        }
        return acc;
    }, {});

    // Process time series data: model yearly active policy types using events
    // Build events per country+measure, then expand to yearly active states
    const activationKeywords = ['introduc', 'reintr', 'resume', 'reactiv', 'adopt', 'pass', 'enact', 'implement', 'launch', 'start'];
    const deactivationKeywords = ['suspend', 'terminat', 'repeal', 'remove', 'expire', 'cancel', 'end', 'discontinu', 'phase', 'sunset', 'halt'];
    const classifyEvent = (detail: string): 'activate' | 'deactivate' | 'other' => {
        const v = detail.toLowerCase();
        if (activationKeywords.some(k => v.includes(k))) return 'activate';
        if (deactivationKeywords.some(k => v.includes(k))) return 'deactivate';
        return 'other';
    };

    // Collect events grouped by country and measure (still needed for deactivation logic in popups)
    const eventsByCountryMeasure: { [country: string]: { [measure: string]: Array<{ year: number, type: 'activate' | 'deactivate' }> } } = {};
    
    // Build time series data: only show bars for years where actual data exists in CSV
    const timeSeriesData: { [country: string]: { [year: number]: { [measure: string]: number } } } = {};
    
    policyCsv.forEach((row: any) => {
        const countryName = normalizePolicyCountryName(row[countryColumnName]);
        const measure = row[measureColumnName] || 'Unknown';
        const rawYear = row[yearColumnName];
        const rawDetail = policyChangedDetailColumnName ? row[policyChangedDetailColumnName] : null;
        const yearNum = rawYear != null ? Number(rawYear) : NaN;
        const detailStr = rawDetail != null ? String(rawDetail) : '';
        if (!countryName || !Number.isFinite(yearNum)) return;
        const countryCode3 = countryNameMap[countryName];
        if (!countryCode3) return;

        // Track events for deactivation logic (used in popups)
        const eventType = classifyEvent(detailStr);
        if (eventType !== 'other') {
            if (!eventsByCountryMeasure[countryCode3]) eventsByCountryMeasure[countryCode3] = {};
            if (!eventsByCountryMeasure[countryCode3][measure]) eventsByCountryMeasure[countryCode3][measure] = [];
            eventsByCountryMeasure[countryCode3][measure].push({ year: yearNum, type: eventType });
        }

        // Only show bar if there's actual data for this country+measure+year
        if (!timeSeriesData[countryCode3]) timeSeriesData[countryCode3] = {};
        if (!timeSeriesData[countryCode3][yearNum]) timeSeriesData[countryCode3][yearNum] = {};
        timeSeriesData[countryCode3][yearNum][measure] = 1;
    });

    if (Object.keys(policyData).length === 0) {
        console.warn("Warning: No policy data was processed. Check if the 'country' column in the spreadsheet is named correctly and if the header row is not sorted with the data.");
    }

    // Process EV data: count "introduced" policies per country
    // Column A (ISO_code) = ISO 3-letter country code
    // Column J (policy_changed_detail) = count rows where value is "introduced"
    console.log("EV CSV columns:", evCsv.columns);
    
    // Find the correct column names from the EV CSV
    const evColumns: string[] = evCsv.columns || [];
    
    // Dynamic column detection for EV data
    const evCountryCodeCol = evColumns.find(c => c && ['iso_code', 'country_code', 'code', 'country'].includes(c.trim().toLowerCase())) || 'ISO_code';
    const evPolicyChangedDetailCol = evColumns.find(c => c && ['policy_changed_detail', 'status', 'change_detail'].includes(c.trim().toLowerCase())) || 'policy_changed_detail';
    const evMeasureCol = evColumns.find(c => c && ['measure', 'policy_type', 'type'].includes(c.trim().toLowerCase())) || 'measure';
    const evLevel1Col = evColumns.find(c => c && ['level_1', 'level1'].includes(c.trim().toLowerCase())) || 'level_1';
    const evUnit1Col = evColumns.find(c => c && ['instrument_level1_unit', 'unit1', 'unit'].includes(c.trim().toLowerCase())) || 'instrument_level1_unit';
    const evYearCol = evColumns.find(c => c && ['start_year', 'year', 'date'].includes(c.trim().toLowerCase())) || 'start_year';
    
    console.log('EV data - using columns:', { 
        evCountryCodeCol, 
        evPolicyChangedDetailCol,
        evMeasureCol,
        evYearCol 
    });
    
    // Log unique values in the policy_changed_detail column to see what values exist
    const uniquePolicyChangedDetailValues = new Set<string>();
    evCsv.forEach((row: any) => {
        const val = row[evPolicyChangedDetailCol];
        if (val) uniquePolicyChangedDetailValues.add(String(val).trim().toLowerCase());
    });
    console.log('EV data - unique policy_changed_detail values:', Array.from(uniquePolicyChangedDetailValues));
    
    const evData: { [countryCode: string]: number } = evCsv.reduce((acc: { [key: string]: number }, row: any) => {
        const countryCodeRaw = row[evCountryCodeCol];
        const policyChangedDetail = row[evPolicyChangedDetailCol];
        
        if (!countryCodeRaw) return acc;
        
        const countryCode = String(countryCodeRaw).trim().toUpperCase();
        const policyChangedValue = String(policyChangedDetail || '').trim().toLowerCase();
        
        // Only count rows where policy_changed_detail is "introduced"
        if (policyChangedValue === 'introduced') {
            if (!acc[countryCode]) {
                acc[countryCode] = 0;
            }
            acc[countryCode]++;
        }
        return acc;
    }, {});
    
    console.log('Processed EV data:', Object.keys(evData).length, 'countries');
    console.log('Sample EV data:', Object.entries(evData).slice(0, 10));

    // Process EV policy types (measure column) per country
    // Using actual column names from the EV CSV
    
    console.log('EV data - using columns for dashboard:', { evMeasureCol, evLevel1Col, evUnit1Col, evYearCol });
    
    // Check what columns actually exist in the EV CSV
    console.log('EV CSV all columns:', evCsv.columns);
    
    // Process EV policy types per country
    const evPolicyTypeData: { [country: string]: { [policyType: string]: number } } = {};
    evCsv.forEach((row: any) => {
        const countryCodeRaw = row[evCountryCodeCol];
        const policyChangedDetail = row[evPolicyChangedDetailCol];
        const measureType = row[evMeasureCol] || 'Unknown';
        
        if (!countryCodeRaw) return;
        
        const countryCode = String(countryCodeRaw).trim().toUpperCase();
        const policyChangedValue = String(policyChangedDetail || '').trim().toLowerCase();
        
        // Only count rows where policy_changed_detail is "introduced"
        if (policyChangedValue === 'introduced') {
            if (!evPolicyTypeData[countryCode]) {
                evPolicyTypeData[countryCode] = {};
            }
            if (!evPolicyTypeData[countryCode][measureType]) {
                evPolicyTypeData[countryCode][measureType] = 0;
            }
            evPolicyTypeData[countryCode][measureType]++;
        }
    });
    
    console.log('Processed EV policy type data:', Object.keys(evPolicyTypeData).length, 'countries');
    console.log('Sample EV policy type data:', Object.entries(evPolicyTypeData).slice(0, 3));
    
    // Process EV time series data - simpler approach: track introduced policies by year
    // For each country+measure, record the year it was introduced and assume it stays active
    const evIntroducedByCountryMeasure: { [country: string]: { [measure: string]: number[] } } = {};
    let evGlobalMinYear: number | null = null;
    let evGlobalMaxYear: number | null = null;
    
    // Debug: log first few rows to see column values
    console.log('EV time series debug - first 3 rows:', evCsv.slice(0, 3).map((row: any) => ({
        ISO_code: row[evCountryCodeCol],
        measure: row[evMeasureCol],
        start_year: row[evYearCol],
        policy_changed_detail: row[evPolicyChangedDetailCol]
    })));
    
    evCsv.forEach((row: any) => {
        const countryCodeRaw = row[evCountryCodeCol];
        const measure = row[evMeasureCol] || 'Unknown';
        const rawYear = row[evYearCol];
        const rawDetail = row[evPolicyChangedDetailCol];
        const yearNum = rawYear != null ? Number(rawYear) : NaN;
        const policyChangedValue = String(rawDetail || '').trim().toLowerCase();
        
        if (!countryCodeRaw) return;
        
        const countryCode = String(countryCodeRaw).trim().toUpperCase();
        
        // Only count rows where policy_changed_detail is "introduced"
        if (policyChangedValue !== 'introduced') return;
        
        // Record the year for this country+measure (even if year is NaN, we'll handle it)
        if (!evIntroducedByCountryMeasure[countryCode]) evIntroducedByCountryMeasure[countryCode] = {};
        if (!evIntroducedByCountryMeasure[countryCode][measure]) evIntroducedByCountryMeasure[countryCode][measure] = [];
        
        if (Number.isFinite(yearNum)) {
            evIntroducedByCountryMeasure[countryCode][measure].push(yearNum);
            if (evGlobalMinYear === null || yearNum < evGlobalMinYear) evGlobalMinYear = yearNum;
            if (evGlobalMaxYear === null || yearNum > evGlobalMaxYear) evGlobalMaxYear = yearNum;
        }
    });
    
    console.log('EV introduced by country measure:', Object.keys(evIntroducedByCountryMeasure).length, 'countries');
    console.log('EV year range:', evGlobalMinYear, '-', evGlobalMaxYear);
    
    // Ensure we have a sensible year range; extend to 2025 for visibility
    const evMinYearForSeries = evGlobalMinYear != null ? evGlobalMinYear : 2000;
    const evMaxYearForSeries = Math.max(evGlobalMaxYear != null ? evGlobalMaxYear : evMinYearForSeries, 2025);
    
    // Build time series: once a policy is introduced, it stays active until the end
    const evTimeSeriesData: { [country: string]: { [year: number]: { [measure: string]: number } } } = {};
    Object.entries(evIntroducedByCountryMeasure).forEach(([countryCode, measuresMap]) => {
        if (!evTimeSeriesData[countryCode]) evTimeSeriesData[countryCode] = {};
        
        Object.entries(measuresMap).forEach(([measure, years]) => {
            if (years.length === 0) return;
            const introYear = Math.min(...years); // First introduction year
            
            // Mark as active from introduction year onwards
            for (let y = evMinYearForSeries; y <= evMaxYearForSeries; y++) {
                if (!evTimeSeriesData[countryCode][y]) evTimeSeriesData[countryCode][y] = {};
                evTimeSeriesData[countryCode][y][measure] = y >= introYear ? 1 : 0;
            }
        });
    });
    
    console.log('Processed EV time series data:', Object.keys(evTimeSeriesData).length, 'countries');
    console.log('Sample EV time series data:', Object.entries(evTimeSeriesData).slice(0, 2));
    
    // Create a global color scale for EV policy types (similar to globalColorScale for policies)
    const allEvPolicyTypes = new Set<string>();
    Object.values(evPolicyTypeData).forEach((types: any) => {
        Object.keys(types).forEach(t => allEvPolicyTypes.add(t));
    });
    const evGlobalColorScale = d3.scaleOrdinal<string, string>()
        .domain(Array.from(allEvPolicyTypes))
        .range(d3.schemeTableau10);
    
    console.log('EV policy types found:', Array.from(allEvPolicyTypes));

    // Process targets data
    console.log("Targets CSV columns:", targetsCsv.columns);
    
    // Create a mapping from 3-digit country codes to country names for targets data
    const countryCode3toName = Object.fromEntries(
        geoData.features.map((feature: any) => [feature.id, feature.properties.name])
    );
    
    // Process renewable targets data globally, restricted to enabled target types.
    const targetsDataByType: { [targetType: string]: { [countryCode: string]: any } } = {};
    const allTargetsDataByCountry: { [countryCode: string]: any[] } = {}; // Store ALL targets for each country
    const allTargetTypes = new Set<string>();
    
    // Dynamic column detection for Targets
    const targetsColumns = targetsCsv.columns || [];
    const tCountryCodeCol = targetsColumns.find((c: string) => c && ['country_code', 'iso_code', 'code'].includes(c.trim().toLowerCase())) || 'Country_code';
    const tDecisionYearCol = targetsColumns.find((c: string) => c && ['year_decision', 'decision_year'].includes(c.trim().toLowerCase())) || 'Year_decision';
    const tTargetYearCol = targetsColumns.find((c: string) => c && ['year_target', 'target_year'].includes(c.trim().toLowerCase())) || 'Year_target';
    const tTargetTypeCol = targetsColumns.find((c: string) => c && ['target_type', 'type'].includes(c.trim().toLowerCase())) || 'Target_type';
    const tTargetConsistentCol = targetsColumns.find((c: string) => c && ['target_consistent', 'consistent', 'target_value', 'value'].includes(c.trim().toLowerCase())) || 'Target_consistent';
    const tTargetAverageCol = targetsColumns.find((c: string) => c && ['target_average', 'average'].includes(c.trim().toLowerCase())) || 'Target_average';

    console.log('Targets data - using columns:', { tCountryCodeCol, tDecisionYearCol, tTargetYearCol, tTargetTypeCol, tTargetConsistentCol, tTargetAverageCol });
    
    targetsCsv.forEach((row: any, index: number) => {
        // New RE targets CSV structure (read by column names for stability):
        const countryCode3Raw = row[tCountryCodeCol] || row[Object.keys(row)[0]];
        const countryCode3 = String(countryCode3Raw ?? '').trim().toUpperCase();
        const decisionYearRaw = row[tDecisionYearCol];
        const targetYearRaw = row[tTargetYearCol]; 
        const rawTargetType = row[tTargetTypeCol];
        const targetType = canonicalRenewableTargetType(rawTargetType);
        const targetConsistent = row[tTargetConsistentCol];
        const targetAverage = row[tTargetAverageCol];
        const targetValueRaw = String(targetConsistent ?? '').trim() !== '' ? targetConsistent : targetAverage;

        if (index < 5) {
            console.log(`Row ${index}:`, {
                countryCode3: countryCode3Raw,
                Year_decision: decisionYearRaw,
                Year_target: targetYearRaw,
                Target_type: rawTargetType,
                Target_consistent: targetConsistent,
                Target_average: targetAverage,
                Target_value_used: targetValueRaw,
                allKeys: Object.keys(row)
            });
        }

        if (
            targetType &&
            ENABLED_RENEWABLE_TARGET_TYPES.has(targetType) &&
            countryCode3 &&
            decisionYearRaw != null &&
            targetYearRaw != null &&
            targetValueRaw != null &&
            String(targetValueRaw).trim() !== ''
        ) {
            const parsedDecisionYear = parseInt(String(decisionYearRaw));
            const parsedTargetYear = parseInt(String(targetYearRaw));
            const parsedTargetValue = parseFloat(String(targetValueRaw));

            if (!isNaN(parsedDecisionYear) && !isNaN(parsedTargetYear) && !isNaN(parsedTargetValue)) {
                if (!allTargetsDataByCountry[countryCode3]) {
                    allTargetsDataByCountry[countryCode3] = [];
                }

                allTargetsDataByCountry[countryCode3].push({
                    targetType: targetType,
                    decisionYear: parsedDecisionYear,
                    targetYear: parsedTargetYear,
                    targetValue: parsedTargetValue
                });

                allTargetTypes.add(targetType);

                if (!targetsDataByType[targetType]) {
                    targetsDataByType[targetType] = {};
                }

                const existing = targetsDataByType[targetType][countryCode3];
                if (!existing || Number(existing.decisionYear) < parsedDecisionYear) {
                    targetsDataByType[targetType][countryCode3] = {
                        decisionYear: parsedDecisionYear,
                        targetYear: parsedTargetYear,
                        targetValue: parsedTargetValue,
                        countryName: countryCode3toName[countryCode3] || countryCode3,
                        targetType: targetType
                    };
                }
            }
        }
    });

    // Pick an initial target type for the targets map in the configured display order.
    const availableTargetTypes = Array.from(ENABLED_RENEWABLE_TARGET_TYPES).filter(targetType => allTargetTypes.has(targetType));
    if (!availableTargetTypes.includes(currentTargetType) && availableTargetTypes.length > 0) {
        currentTargetType = availableTargetTypes.includes('Electricity')
            ? 'Electricity'
            : (availableTargetTypes.includes('Final energy') ? 'Final energy' : availableTargetTypes[0]);
    }

    const targetsData = targetsDataByType[currentTargetType] || {};
    
    console.log("Available target types:", Array.from(allTargetTypes));
    console.log("Processed targets data by type:", Object.keys(targetsDataByType));
    console.log(`${currentTargetType} targets:`, Object.keys(targetsData).length, "countries");
    console.log("Sample targets data:", Object.entries(targetsData).slice(0, 3));

    // Process climate targets data (EU only)
    console.log("Climate Targets CSV columns:", climateTargetsCsv.columns);

    // Dynamic column detection for Climate Targets
    const ctColumns = climateTargetsCsv.columns || [];
    const ctCountryCodeCol = ctColumns.find((c: string) => c && ['country_code', 'iso_code', 'code'].includes(c.trim().toLowerCase())) || 'Country_code';
    const ctYearDecisionCol = ctColumns.find((c: string) => c && ['year_decision', 'decision_year'].includes(c.trim().toLowerCase())) || 'Year_decision';
    const ctYearTargetCol = ctColumns.find((c: string) => c && ['year_target', 'target_year'].includes(c.trim().toLowerCase())) || 'Year_target';
    
    // Explicitly prioritize Target_consistent_all over Target_consistent
    const ctTargetConsistentCol = ctColumns.find((c: string) => c && c.trim().toLowerCase() === 'target_consistent_all') 
        || ctColumns.find((c: string) => c && ['target_consistent', 'target_value'].includes(c.trim().toLowerCase())) 
        || 'Target_consistent_all';
        
    const ctTargetUnitCol = ctColumns.find((c: string) => c && ['target_unit', 'unit', 'target_unit'].includes(c.trim().toLowerCase())) || 'Target_unit';

    console.log('Climate Targets - using columns:', { 
        ctCountryCodeCol, 
        ctYearDecisionCol, 
        ctYearTargetCol, 
        ctTargetConsistentCol, 
        ctTargetUnitCol 
    });
    
    const climateTargetsData: { [countryCode: string]: any[] } = {};
    
    climateTargetsCsv.forEach((row: any, index: number) => {
        // New CSV structure: use column R "Target_consistent_all" for the value
        // (sheet includes many columns; we read by name for stability)
        const countryCode3Raw = row[ctCountryCodeCol] || row[Object.keys(row)[0]];
        const countryCode3 = String(countryCode3Raw ?? '').trim().toUpperCase();
        const yearDecision = row[ctYearDecisionCol];
        const yearTarget = row[ctYearTargetCol];
        const targetConsistentAll = row[ctTargetConsistentCol] ?? row[ctTargetConsistentCol]?.toString?.();
        const targetUnit = row[ctTargetUnitCol];
        
        // Process climate targets:
        // - EU countries only
        // - ONLY include rows where Target_unit is "Percent"
        // - Target value comes from Target_consistent_all (column R)
        if (countryCode3 && EU_COUNTRY_CODES_3.has(countryCode3) && yearDecision && yearTarget && targetConsistentAll != null && targetUnit) {
            const normalizedUnit = String(targetUnit).trim().toLowerCase();
            
            // Only process if Target_unit is "Percent"
            if (normalizedUnit === 'percent') {
                const parsedYearDecision = parseInt(yearDecision);
                const parsedYearTarget = parseInt(yearTarget);
                const parsedTargetAverage = parseFloat(targetConsistentAll);
                
                if (!isNaN(parsedYearDecision) && !isNaN(parsedYearTarget) && !isNaN(parsedTargetAverage)) {
                    if (!climateTargetsData[countryCode3]) {
                        climateTargetsData[countryCode3] = [];
                    }
                    
                    climateTargetsData[countryCode3].push({
                        yearDecision: parsedYearDecision,
                        yearTarget: parsedYearTarget,
                        targetValue: parsedTargetAverage,
                        countryName: countryCode3toName[countryCode3] || countryCode3,
                        targetUnit: targetUnit
                    });
                }
            }
        }
    });
    
    // For each country, select the latest target based on year decision
    const latestClimateTargetsData: { [countryCode: string]: any } = {};
    Object.entries(climateTargetsData).forEach(([countryCode, targets]) => {
        // Sort by year decision (most recent first)
        const sortedTargets = targets.sort((a, b) => b.yearDecision - a.yearDecision);
        latestClimateTargetsData[countryCode] = sortedTargets[0];
    });
    
    console.log("Processed climate targets data:", Object.keys(latestClimateTargetsData).length, "countries");
    console.log("Sample climate targets data:", Object.entries(latestClimateTargetsData).slice(0, 3));

    // Store all processed data globally
    allData = {
        geoData,
        policies: {
            data: policyData,
            timeSeriesData: timeSeriesData,
            colorScale: null, // Will be set below
            globalColorScale: globalColorScale
        },
        targets: {
            data: targetsData,
            dataByType: targetsDataByType,
            allTargetTypes: availableTargetTypes,
            allTargetsByCountry: allTargetsDataByCountry, // All targets for dashboard
            colorScale: null, // Will be set below
            colorScales: {}, // Will store color scales for each target type
            minMax: {} // Will store min/max values for each target type
        },
        climateTargets: {
            data: latestClimateTargetsData,
            allData: climateTargetsData,
            colorScale: null, // Will be set below
            minMax: { min: 0, max: 0 } // Will be set below
        },
        ev: {
            data: evData,
            rawCsv: evCsv,
            typeData: evPolicyTypeData,
            timeSeriesData: evTimeSeriesData,
            globalColorScale: evGlobalColorScale,
            colorScale: null, // Will be set below
            minMax: { min: 0, max: 0 } // Will be set below
        },
        rawSources: {
            policyCsv,
            targetsCsv,
            climateTargetsCsv,
            evCsv,
        }
    };

    // Fix currentTargetType if the preferred type is not available (should be rare after filtering)
    if (!allData.targets.allTargetTypes.includes(currentTargetType) && allData.targets.allTargetTypes.length > 0) {
        currentTargetType = allData.targets.allTargetTypes.includes('Electricity')
            ? 'Electricity'
            : (allData.targets.allTargetTypes.includes('Final energy') ? 'Final energy' : allData.targets.allTargetTypes[0]);
    }

    // Create color scales for different map types
    const policyCounts = Object.values(policyData).reduce((acc: number[], value) => {
        if (typeof value === 'number') {
            acc.push(value);
        }
        return acc;
    }, []);
    const minPolicies = d3.min(policyCounts);
    const maxPolicies = d3.max(policyCounts);
    
    const policyColorScale = d3.scaleSequential(d3.interpolateGreens)
        .domain([minPolicies as number, maxPolicies as number]);

    // Create color scales for each target type
    const targetColorScales: { [key: string]: any } = {};
    const targetMinMax: { [key: string]: { min: number, max: number } } = {};
    
    allTargetTypes.forEach(targetType => {
        const typeData = targetsDataByType[targetType] || {};
        const targetValues = Object.values(typeData).map((d: any) => d.targetValue);
        if (targetValues.length > 0) {
            const rawMinValue = d3.min(targetValues) as number;
            const minValue = rawMinValue < RENEWABLE_TARGET_COLOR_MAX ? rawMinValue : 0;
            targetMinMax[targetType] = { min: minValue, max: RENEWABLE_TARGET_COLOR_MAX };
            targetColorScales[targetType] = d3.scaleSequential(d3.interpolateBlues)
                .domain([minValue, RENEWABLE_TARGET_COLOR_MAX])
                .clamp(true);
        }
    });
    
    // Global min/max across enabled target types for consistent legend gradient
    const allEnabledTargetValues: number[] = [];
    allTargetTypes.forEach(targetType => {
        const typeData = targetsDataByType[targetType] || {};
        Object.values(typeData).forEach((d: any) => {
            if (d && typeof d.targetValue === 'number' && Number.isFinite(d.targetValue)) {
                allEnabledTargetValues.push(d.targetValue);
            }
        });
    });

    const rawMinTargets = allEnabledTargetValues.length > 0 ? (d3.min(allEnabledTargetValues) as number) : 0;
    const minTargets = rawMinTargets < RENEWABLE_TARGET_COLOR_MAX ? rawMinTargets : 0;
    const maxTargets = RENEWABLE_TARGET_COLOR_MAX;

    const targetsColorScale = d3.scaleSequential(d3.interpolateBlues)
        .domain([minTargets, maxTargets])
        .clamp(true);

    // Create color scale for EV data based on actual data
    const evCounts = Object.values(evData) as number[];
    const minEv = evCounts.length > 0 ? (d3.min(evCounts) as number) : 0;
    const maxEv = evCounts.length > 0 ? (d3.max(evCounts) as number) : 10;
    // Custom lighter orange scale: from very light peach to medium orange
    const evColorScale = d3.scaleSequential(d3.interpolateRgb('#fff5eb', '#f97316'))
        .domain([minEv, maxEv]);

    // Create color scale for climate targets
    // REVERSED: Lower values (e.g., -100) represent bigger reductions, so they should be darkest
    const climateTargetValues = Object.values(latestClimateTargetsData).map((d: any) => d.targetValue);
    const minClimateTarget = climateTargetValues.length > 0 ? d3.min(climateTargetValues) : -100;
    const maxClimateTarget = climateTargetValues.length > 0 ? d3.max(climateTargetValues) : 0;
    const climateTargetsColorScale = d3.scaleSequential(d3.interpolatePurples)
        .domain([maxClimateTarget as number, minClimateTarget as number]); // REVERSED: max to min

    // Store color scales in allData
    allData.policies.colorScale = policyColorScale;
    allData.targets.colorScale = targetsColorScale;
    allData.targets.colorScales = targetColorScales;
    allData.targets.minMax = targetMinMax;
    allData.ev.colorScale = evColorScale;
    allData.ev.minMax = { min: minEv, max: maxEv };
    allData.climateTargets.colorScale = climateTargetsColorScale;
    allData.climateTargets.minMax = { min: minClimateTarget as number, max: maxClimateTarget as number };

    // Function to get country color based on current map type
    function getCountryColor(countryCode: string): string {
        if (currentMapType === 'policies') {
            return countryCode && policyData[countryCode] ? policyColorScale(policyData[countryCode]) : '#b0b0b0';
        } else if (currentMapType === 'targets') {
            // Use current target type data with the appropriate color scale
            const currentTargetData = allData.targets.dataByType[currentTargetType] || {};
            const currentColorScale = allData.targets.colorScales[currentTargetType];
            
            // Debug logging for first few countries
            if (countryCode === 'USA' || countryCode === 'DEU' || countryCode === 'CHN') {
                console.log(`getCountryColor for ${countryCode}:`, {
                    currentTargetType,
                    currentTargetData: currentTargetData[countryCode],
                    currentColorScale: !!currentColorScale,
                    allTargetTypes: allData.targets.allTargetTypes,
                    dataByTypeKeys: Object.keys(allData.targets.dataByType || {}),
                    colorScalesKeys: Object.keys(allData.targets.colorScales || {})
                });
            }
            
            if (countryCode && currentTargetData[countryCode] && currentColorScale) {
                const info = currentTargetData[countryCode];
                const targetValue = info.targetValue;
                if (currentTargetFilterMode === 'group') {
                    // 'latest' mode: show latest announced target regardless of year group
                    if (currentTargetYearGroup === 'latest') {
                        return currentColorScale(targetValue);
                    }
                    // Year group filtering (2020, 2030, 2050)
                    const group = getYearGroup(Number(info.targetYear));
                    if (group && group === currentTargetYearGroup) {
                        return currentColorScale(targetValue);
                    }
                    return '#d4d4d4';
                }
                // Fallback: show latest announced target
                return currentColorScale(targetValue);
            } else {
                return '#b0b0b0';
            }
        } else if (currentMapType === 'climateTargets') {
            // Climate targets data with year group filtering
            const allClimateTargets = allData.climateTargets.allData || {};
            const currentColorScale = allData.climateTargets.colorScale;
            
            if (countryCode && allClimateTargets[countryCode] && currentColorScale) {
                const targets = allClimateTargets[countryCode];
                
                if (currentClimateTargetYearGroup === 'latest') {
                    // Show the most recent target (by decision year)
                    const latestTarget = targets.sort((a: any, b: any) => b.yearDecision - a.yearDecision)[0];
                    return currentColorScale(latestTarget.targetValue);
                }
                
                // Year group filtering (2020, 2030, 2050)
                // Find targets that match the selected year group
                const matchingTargets = targets.filter((t: any) => {
                    const group = getYearGroup(Number(t.yearTarget));
                    return group === currentClimateTargetYearGroup;
                });
                
                if (matchingTargets.length > 0) {
                    // Use the most recent target (by decision year) within the matching group
                    const latestMatchingTarget = matchingTargets.sort((a: any, b: any) => b.yearDecision - a.yearDecision)[0];
                    return currentColorScale(latestMatchingTarget.targetValue);
                }
                
                return '#d4d4d4';
            } else {
                return '#b0b0b0';
            }
        } else if (currentMapType === 'ev') {
            // EV Support Policies data
            const evPolicyData = allData.ev.data || {};
            const evColorScaleLocal = allData.ev.colorScale;
            if (countryCode && evPolicyData[countryCode] && evColorScaleLocal) {
                return evColorScaleLocal(evPolicyData[countryCode]);
            }
            return '#b0b0b0';
        }
        return '#b0b0b0';
    }

    // Function to get tooltip content based on current map type
    function getTooltipContent(countryCode: string, countryName: string): string {
        const fmt1 = (v: any) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return String(v);
            const r = Math.round(n * 10) / 10;
            return r % 1 === 0 ? String(Math.trunc(r)) : r.toFixed(1);
        };
        if (currentMapType === 'policies') {
            const policyCount = policyData[countryCode] || 'No data';
            return `<strong>${countryName}</strong><br/>RE Support: ${policyCount}`;
        } else if (currentMapType === 'targets') {
            const currentTargetData = allData.targets.dataByType[currentTargetType] || {};
            const targetInfo = currentTargetData[countryCode];
            const displayName = getTargetTypeDisplayName(currentTargetType);
            if (targetInfo) {
                const decisionLabel = (targetInfo as any).decisionYear ?? (targetInfo as any).decisionDate ?? '—';
                return `<strong>${countryName}</strong><br/>Target Type: ${displayName}<br/>Target: ${targetInfo.targetValue}% by ${targetInfo.targetYear}<br/>Decision: ${decisionLabel}`;
            } else {
                return `<strong>${countryName}</strong><br/>No ${displayName} target data`;
            }
        } else if (currentMapType === 'climateTargets') {
            const allClimateTargets = allData.climateTargets.allData || {};
            if (allClimateTargets[countryCode]) {
                const targets = allClimateTargets[countryCode];
                
                if (currentClimateTargetYearGroup === 'latest') {
                    // Show the most recent target (by decision year)
                    const latestTarget = targets.sort((a: any, b: any) => b.yearDecision - a.yearDecision)[0];
                    return `<strong>${countryName}</strong><br/>Emission Target: ${fmt1(latestTarget.targetValue)}% by ${latestTarget.yearTarget}<br/>Decision Year: ${latestTarget.yearDecision}`;
                }
                
                // Year group filtering - show target matching the selected year group
                const matchingTargets = targets.filter((t: any) => {
                    const group = getYearGroup(Number(t.yearTarget));
                    return group === currentClimateTargetYearGroup;
                });
                
                if (matchingTargets.length > 0) {
                    const latestMatchingTarget = matchingTargets.sort((a: any, b: any) => b.yearDecision - a.yearDecision)[0];
                    return `<strong>${countryName}</strong><br/>Emission Target: ${fmt1(latestMatchingTarget.targetValue)}% by ${latestMatchingTarget.yearTarget}<br/>Decision Year: ${latestMatchingTarget.yearDecision}`;
                } else {
                    return `<strong>${countryName}</strong><br/>No emission target data for ${currentClimateTargetYearGroup}`;
                }
            } else {
                return `<strong>${countryName}</strong><br/>No emission target data`;
            }
        } else if (currentMapType === 'ev') {
            const evPolicyData = allData.ev.data || {};
            const evCount = evPolicyData[countryCode];
            if (evCount !== undefined) {
                return `<strong>${countryName}</strong><br/>EV Support Policies: ${evCount}`;
            } else {
                return `<strong>${countryName}</strong><br/>No EV policy data`;
            }
        }
        return `<strong>${countryName}</strong>`;
    }

    // Function to update legend colors based on map type
    function updateLegendColors(mapType: string) {
        const linearGradient = svg.select("#gradient-color");
        let interpolateFunction;
        let minValue, maxValue;

        switch (mapType) {
            case 'policies':
                interpolateFunction = d3.interpolateGreens;
                minValue = minPolicies;
                maxValue = maxPolicies;
                break;
            case 'targets':
                interpolateFunction = d3.interpolateBlues;
                // Use same min/max for all target types for consistency
                minValue = minTargets;
                maxValue = maxTargets;
                break;
            case 'climateTargets':
                interpolateFunction = d3.interpolatePurples;
                // REVERSED: Display max (less reduction) on left, min (more reduction) on right
                minValue = maxClimateTarget;
                maxValue = minClimateTarget;
                break;
            case 'ev':
                // Custom lighter orange: from very light peach to medium orange
                interpolateFunction = (t: number) => d3.interpolateRgb('#fff5eb', '#f97316')(t);
                minValue = minEv;
                maxValue = maxEv;
                break;
            default:
                interpolateFunction = d3.interpolateGreens;
                minValue = minPolicies;
                maxValue = maxPolicies;
        }

        const stops = d3.range(0, 1.01, 0.25).map(t => ({
            offset: `${t * 100}%`,
            color: interpolateFunction(t)
        }));

        linearGradient.selectAll("stop")
            .data(stops)
            .attr("stop-color", d => d.color);

        // Update legend text
        svg.select(".legend").selectAll("text").remove();
        
        svg.select(".legend").append("text")
            .attr("x", 0)
            .attr("y", 40)
            .style("font-size", "12px")
            .text(Math.round(minValue as number));

        svg.select(".legend").append("text")
            .attr("x", 300)
            .attr("y", 40)
            .style("font-size", "12px")
            .text(Math.round(maxValue as number));
    }

    // Function to update map zoom based on map type
    function updateMapZoom(mapType: string) {
        const europeCenter: [number, number] = [5, 48]; // lon, lat for center of Western Europe

        if (mapType === 'targets') {
            const worldScale = 1.25;
            svg.transition()
                .duration(750)
                .call(zoom.transform as any, d3.zoomIdentity
                    .translate((width * (1 - worldScale)) / 2, (height * (1 - worldScale)) / 2)
                    .scale(worldScale));
            return;
        }

        const europeScale = 5;
        const europeTranslate = projection(europeCenter)!;

        svg.transition()
            .duration(750)
            .call(zoom.transform as any, d3.zoomIdentity
                .translate(width / 2 - europeTranslate[0] * europeScale, height / 2 - europeTranslate[1] * europeScale)
                .scale(europeScale));
    }

    // Function to update map visualization
    // pass skipZoom=true to avoid resetting zoom (used for intra-mode filter changes)
    function updateMap(skipZoom: boolean = false) {
        const isRegulationsMode = currentMapType === 'regulations';
        setRegulationsVisible(isRegulationsMode);
        if (isRegulationsMode) {
            return;
        }

        g.selectAll("path")
            .transition()
            .duration(500)
            .attr("fill", (d: any) => getCountryColor(d.id));
        
        // Update legend colors
        updateLegendColors(currentMapType);
        
        // Update map zoom unless explicitly skipped
        if (!skipZoom) {
            updateMapZoom(currentMapType);
        }
        
        // Initialize submenu if switching to targets
        if (currentMapType === 'targets') {
            initializeTargetsSubmenu();
        }
    }
    
    // Assign wrapper for intra-mode changes to avoid zoom reset
    // Submenu interactions call updateMapFunction(); main mode switches call updateMap() directly
    updateMapFunction = () => updateMap(true);

    // Show dashboard interaction hints only once (first country click)
    let hasShownDashboardHints = false;

    // Render a country dashboard in the modal with targets progression and policy timeline charts
    function createCountryDashboardModal(countryCode3: string, countryName: string) {
        const modalContent = document.getElementById('modal-content');
        const modalTitle = document.getElementById('modal-title');
        if (!modalContent) return;

        if (modalTitle) {
            modalTitle.textContent = `${countryName} — Dashboard`;
        }

        // Helper to format labels: Title Case, with specific abbreviations fully uppercased
        const formatPolicyLabel = (s: string) => {
            const lower = s.toLowerCase();
            const upperAbbr = new Set(['fit', 'tgc', 'pv']);
            if (upperAbbr.has(lower)) return lower.toUpperCase();
            return lower.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        };

        const fmt1 = (v: any) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return String(v ?? '');
            const rounded = Math.round(n * 10) / 10;
            return String(rounded);
        };

		// Check if we're in EV mode
		const isEvModeEarly = currentMapType === 'ev';
		
		// Check for EV time series data
		const evTimeSeriesEarly = allData.ev.timeSeriesData || {};
		const countryEvTimeEarly = evTimeSeriesEarly[countryCode3];
		let hasEvTimeSeriesDataEarly = false;
		if (countryEvTimeEarly && Object.keys(countryEvTimeEarly).length > 0) {
			hasEvTimeSeriesDataEarly = Object.values(countryEvTimeEarly).some((yd: any) => Object.values(yd || {}).some((v: any) => Number(v) > 0));
		}
		
		// Check for RE policy time series data
		const countryTimeEarly = timeSeriesData[countryCode3];
		let hasTimeSeriesEarly = false;
		if (countryTimeEarly && Object.keys(countryTimeEarly).length > 0) {
			hasTimeSeriesEarly = Object.values(countryTimeEarly).some((yd: any) => Object.values(yd || {}).some((v: any) => Number(v) > 0));
		}
		
		// Check if there are any targets for this country (shown in both modes)
		const countryTargetsEarly = allData.targets.allTargetsByCountry?.[countryCode3] || [];
		const hasTargetsDataEarly = countryTargetsEarly.length > 0;
		
		// Check if there are any climate targets for this country
		const allClimateTargets = allData.climateTargets.allData || {};
		const hasClimateTargetsData = allClimateTargets[countryCode3] && 
			Object.values(allClimateTargets[countryCode3]).some((targets: any) => 
				Array.isArray(targets) && targets.length > 0
			);
		
		// Determine if we have any data to show based on mode
        const hasAnyData = isEvModeEarly 
            ? (hasTargetsDataEarly || hasEvTimeSeriesDataEarly) // EV mode: targets OR EV time series
            : (hasTimeSeriesEarly || hasTargetsDataEarly || hasClimateTargetsData); // RE mode
        
        // Prepare modal content container for flex layout to avoid scrolling
        modalContent.style.display = 'flex';
        modalContent.style.flexDirection = 'column';
        modalContent.style.overflow = 'hidden';

        if (!hasAnyData) {
			const noDataMessage = isEvModeEarly 
				? `We don't have EV support data for ${countryName} yet. We're working to add it soon.`
				: `We don't have dashboard data for ${countryName} yet. We're working to add it soon.`;
			modalContent.innerHTML = `
				<div style="display:flex;align-items:center;justify-content:center;height:100%;">
					<div style="text-align:center;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px 20px;max-width:560px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
						<div style="font-size:18px;font-weight:700;margin-bottom:6px;">We're on it</div>
						<div style="font-size:14px;">${noDataMessage}</div>
					</div>
				</div>`;
			openModal();
			return;
		}

        // Layout container
        modalContent.innerHTML = `
            <div id="dashboard-top" style="display:flex; gap:16px; width:100%; flex:1; min-height:0; flex-direction:row; position:relative;">
                <div id="dashboard-pie" style="flex:1; min-height:200px; background:#f8fafc; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,0.06);"></div>
                <div id="dashboard-timeseries" style="flex:1; min-height:200px; background:#f8fafc; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,0.06);"></div>
            </div>
        `;

        // Open the modal before measuring sizes to ensure containers have dimensions
        openModal();

        // Defer rendering to the next frame so layout is updated
        requestAnimationFrame(() => {
            // Stack vertically on narrow widths
            const layout = document.getElementById('dashboard-top');
            if (layout) {
                const updateLayout = () => {
                    const w = layout.getBoundingClientRect().width;
                    layout.style.flexDirection = w < 768 ? 'column' : 'row';
                };
                updateLayout();
                // Continuously adapt layout on resize while modal is open
                window.addEventListener('resize', updateLayout);

                // Show a single centered interaction note only on the first country click
                if (!hasShownDashboardHints) {
                    (layout as HTMLElement).style.position = 'relative';
                    d3.select(layout)
                        .append('div')
                        .attr('class', 'chart-interaction-hint')
                        .style('position', 'absolute')
                        .style('top', '50%')
                        .style('left', '50%')
                        .style('transform', 'translate(-50%, -50%)')
                        .style('z-index', '60')
                        .style('padding', '10px 14px')
                        .style('border-radius', '10px')
                        .style('background', 'rgba(31,41,55,0.6)')
                        .style('color', '#fff')
                        .style('font-size', '13px')
                        .style('box-shadow', '0 4px 10px rgba(0,0,0,0.15)')
                        .style('pointer-events', 'none')
                        .style('opacity', '0.95')
                        .text('These graphs are interactive. Click to see details.')
                        .transition()
                        .delay(3500)
                        .duration(500)
                        .style('opacity', '0');
                    hasShownDashboardHints = true;
                }
            }

            const leftContainer = document.getElementById('dashboard-pie');
            const countryTargets = allData.targets.allTargetsByCountry?.[countryCode3] || [];
            
            // Track map modes for conditional chart rendering
            const isEvMode = currentMapType === 'ev';
            const isClimateTargetsMode = currentMapType === 'climateTargets';

            if (leftContainer) {
                (leftContainer as HTMLElement).style.position = 'relative';
                leftContainer.innerHTML = '';
            }
            
            // EV mode: Don't show the left chart at all (only EV timeline on right)
            // Also make the right container take full width
            const tsContainerForLayout = document.getElementById('dashboard-timeseries');
            const isTargetsMode = currentMapType === 'targets';
            if (isEvMode) {
                // EV mode: hide left chart, expand right (policy timeline) to full width
                if (leftContainer) {
                    leftContainer.style.display = 'none';
                }
                if (tsContainerForLayout) {
                    tsContainerForLayout.style.display = '';
                    tsContainerForLayout.style.flex = '1 1 100%';
                }
            } else if (isTargetsMode || isClimateTargetsMode) {
                // Targets modes: hide policy timeline, expand left (targets chart) to full width
                if (leftContainer) {
                    leftContainer.style.display = 'flex';
                    leftContainer.style.flexDirection = 'column';
                    leftContainer.style.flex = '1 1 100%';
                }
                if (tsContainerForLayout) {
                    tsContainerForLayout.style.display = 'none';
                }
            } else {
                // Policies mode: show both side by side
                if (leftContainer) {
                    leftContainer.style.display = 'flex';
                    leftContainer.style.flexDirection = 'column';
                    leftContainer.style.flex = '1';
                }
                if (tsContainerForLayout) {
                    tsContainerForLayout.style.display = '';
                    tsContainerForLayout.style.flex = '1';
                }
            }
            
            // Climate Targets mode: Show Climate Targets Progression instead of RE Targets
            if (isClimateTargetsMode && leftContainer) {
                // allData.climateTargets.allData[countryCode] is an ARRAY of targets
                const countryClimateTargetsRaw = allData.climateTargets.allData?.[countryCode3] || [];
                const climateTargetsList: any[] = [];
                
                // The data is already an array of target objects
                if (Array.isArray(countryClimateTargetsRaw)) {
                    countryClimateTargetsRaw.forEach((t: any) => {
                        climateTargetsList.push({
                            decisionYear: Number(t.yearDecision),
                            targetYear: Number(t.yearTarget),
                            targetValue: Number(t.targetValue),
                            targetUnit: t.targetUnit || '%'
                        });
                    });
                }
                
                if (climateTargetsList.length > 0) {
                    const targetsContainer = leftContainer as HTMLElement;
                    const rect = targetsContainer.getBoundingClientRect();
                    const citationHeight = 60; // Reserve space for citation
                    const margin = { top: 40, right: 60, bottom: 20, left: 60 };
                    const width = rect.width - margin.left - margin.right;
                    const height = rect.height - margin.top - margin.bottom - citationHeight;
                    
                    const svg = d3.select(targetsContainer).append('svg')
                        .attr('width', rect.width)
                        .attr('height', rect.height - citationHeight)
                        .style('background', '#f8fafc')
                        .style('border-radius', '12px');
                    addLogoWatermark(svg as any, rect.width);

                    const g = svg.append('g')
                        .attr('transform', `translate(${margin.left}, ${margin.top})`);

                    // Create custom tooltip
                    const tooltip = d3.select(targetsContainer).append('div')
                        .attr('class', 'climate-target-tooltip')
                        .style('position', 'absolute')
                        .style('visibility', 'hidden')
                        .style('background', 'rgba(0, 0, 0, 0.9)')
                        .style('color', '#fff')
                        .style('padding', '6px 10px')
                        .style('border-radius', '4px')
                        .style('font-size', '11px')
                        .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                        .style('pointer-events', 'none')
                        .style('z-index', '10000')
                        .style('white-space', 'nowrap')
                        .style('box-shadow', '0 2px 4px rgba(0, 0, 0, 0.2)');

                    // Chart title
                    svg.append('text')
                        .attr('x', rect.width / 2)
                        .attr('y', 20)
                        .style('text-anchor', 'middle')
                        .style('font-size', '15px')
                        .style('font-weight', '700')
                        .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                        .style('fill', '#1e293b')
                        .text('Climate Targets Progression');

                    // Determine the year range
                    const allYears = climateTargetsList.flatMap((t: any) => [t.decisionYear, t.targetYear]).filter(y => Number.isFinite(y));
                    const minYear = Math.min(...allYears);
                    const maxYear = Math.max(...allYears);
                    const yearPadding = Math.max(2, Math.ceil((maxYear - minYear) * 0.1));
                    
                    // Determine target value range (climate targets can be negative for reductions)
                    const allValues = climateTargetsList.map(t => t.targetValue).filter(v => Number.isFinite(v));
                    const minVal = Math.min(...allValues, 0);
                    const maxVal = Math.max(...allValues, 0);
                    const valPadding = Math.max(5, Math.abs(maxVal - minVal) * 0.1);
                    
                    // Scales
                    const xScale = d3.scaleLinear()
                        .domain([minYear - yearPadding, maxYear + yearPadding])
                        .range([0, width]);
                    
                    const yScale = d3.scaleLinear()
                        .domain([minVal - valPadding, maxVal + valPadding])
                        .range([height, 0]);
                    
                    // Grid lines
                    const gridGroup = g.append('g').attr('class', 'grid');
                    gridGroup.selectAll('.grid-h')
                        .data(yScale.ticks(5))
                        .enter().append('line')
                        .attr('class', 'grid-h')
                        .attr('x1', 0)
                        .attr('x2', width)
                        .attr('y1', d => yScale(d))
                        .attr('y2', d => yScale(d))
                        .style('stroke', '#e2e8f0')
                        .style('stroke-dasharray', '3,3')
                        .style('opacity', 0.5);
                    
                    // Zero line (important for climate targets showing reductions)
                    if (minVal < 0 && maxVal > 0) {
                        g.append('line')
                            .attr('x1', 0)
                            .attr('x2', width)
                            .attr('y1', yScale(0))
                            .attr('y2', yScale(0))
                            .style('stroke', '#94a3b8')
                            .style('stroke-width', 1);
                    }
                    
                    // Axes
                    const xAxis = d3.axisBottom(xScale)
                        .tickFormat(d => d3.format('d')(d as number))
                        .ticks(Math.min(8, maxYear - minYear));
                    
                    const yAxis = d3.axisLeft(yScale)
                        .tickFormat(d => `${d}%`)
                        .ticks(5);
                    
                    g.append('g')
                        .attr('transform', `translate(0, ${height})`)
                        .call(xAxis)
                        .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                        .style('font-size', '11px')
                        .style('color', '#64748b');
                    
                    g.append('g')
                        .call(yAxis)
                        .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                        .style('font-size', '11px')
                        .style('color', '#64748b');
                    
                    // Axis labels
                    g.append('text')
                        .attr('x', width / 2)
                        .attr('y', height + 45)
                        .style('text-anchor', 'middle')
                        .style('font-size', '12px')
                        .style('font-weight', '600')
                        .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                        .style('fill', '#475569')
                        .text('Year');
                    
                    g.append('text')
                        .attr('transform', 'rotate(-90)')
                        .attr('x', -height / 2)
                        .attr('y', -45)
                        .style('text-anchor', 'middle')
                        .style('font-size', '12px')
                        .style('font-weight', '600')
                        .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                        .style('fill', '#475569')
                        .text('Emission Reduction Target (%)');

                    // Add Citation
                    d3.select(targetsContainer).append('div')
                        .style('flex', '0 0 auto') // Don't grow or shrink
                        .style('padding', '10px 20px')
                        .style('font-size', '9px')
                        .style('color', '#64748b')
                        .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                        .style('line-height', '1.4')
                        .style('max-width', '100%')
                        .style('background', '#f8fafc') // Match container background
                        .html(`<strong>Suggested Citation:</strong> ${CITATION_CLIMATE}`);
                    
                    // Color for climate targets (purple to match map)
                    const climateColor = '#7c3aed'; // Purple for climate targets
                    
                    // Sort targets by decision year
                    climateTargetsList.sort((a, b) => a.decisionYear - b.decisionYear);
                    
                    // Helper to format values
                    const fmtVal = (v: number) => v.toFixed(1);
                    
                    // Draw each target with same logic as renewable targets
                    climateTargetsList.forEach((target: any, index: number) => {
                        // Find the next target that actually supersedes this one (SAME target year only)
                        // Different target years coexist as milestones
                        let nextTarget = null;
                        for (let i = index + 1; i < climateTargetsList.length; i++) {
                            const candidate = climateTargetsList[i];
                            if (candidate.targetYear === target.targetYear) {
                                nextTarget = candidate;
                                break;
                            }
                        }
                        
                        // If there's a superseding target announced before this one's deadline, end the line there
                        const endYear = (nextTarget && nextTarget.decisionYear < target.targetYear) 
                            ? nextTarget.decisionYear 
                            : target.targetYear;
                        
                        // Draw horizontal line from decision year to end year
                        g.append('line')
                            .attr('x1', xScale(target.decisionYear))
                            .attr('y1', yScale(target.targetValue))
                            .attr('x2', xScale(endYear))
                            .attr('y2', yScale(target.targetValue))
                            .style('stroke', climateColor)
                            .style('stroke-width', 3)
                            .style('opacity', 0.8)
                            .style('cursor', 'pointer')
                            .on('mouseenter', function(event: any) {
                                const [mouseX, mouseY] = d3.pointer(event, targetsContainer);
                                const tooltipText = endYear !== target.targetYear 
                                    ? `${fmtVal(target.targetValue)}% target from ${target.decisionYear} to ${endYear} (superseded, original deadline: ${target.targetYear})`
                                    : `${fmtVal(target.targetValue)}% target from ${target.decisionYear} to ${target.targetYear}`;
                                tooltip
                                    .style('visibility', 'visible')
                                    .html(tooltipText)
                                    .style('top', (mouseY + 10) + 'px')
                                    .style('left', (mouseX + 10) + 'px');
                            })
                            .on('mouseleave', function() {
                                tooltip.style('visibility', 'hidden');
                            });
                        
                        // If superseded by same-year target, draw vertical dashed connection line
                        if (nextTarget && endYear !== target.targetYear) {
                            g.append('line')
                                .attr('x1', xScale(endYear))
                                .attr('x2', xScale(endYear))
                                .attr('y1', yScale(target.targetValue))
                                .attr('y2', yScale(nextTarget.targetValue))
                                .style('stroke', climateColor)
                                .style('stroke-width', 2)
                                .style('stroke-dasharray', '4,3')
                                .style('opacity', 0.6)
                                .style('cursor', 'pointer')
                                .on('mouseenter', function(event: any) {
                                    const [mouseX, mouseY] = d3.pointer(event, targetsContainer);
                                    tooltip
                                        .style('visibility', 'visible')
                                        .html(`Target for ${target.targetYear} updated in ${nextTarget.decisionYear}<br/>From ${fmtVal(target.targetValue)}% to ${fmtVal(nextTarget.targetValue)}%`)
                                        .style('top', (mouseY + 10) + 'px')
                                        .style('left', (mouseX + 10) + 'px');
                                })
                                .on('mouseleave', function() {
                                    tooltip.style('visibility', 'hidden');
                                });
                        }
                        
                        // Decision point (start)
                        g.append('circle')
                            .attr('cx', xScale(target.decisionYear))
                            .attr('cy', yScale(target.targetValue))
                            .attr('r', 5)
                            .style('fill', climateColor)
                            .style('stroke', '#fff')
                            .style('stroke-width', 2)
                            .style('cursor', 'pointer')
                            .on('mouseenter', function(event: any) {
                                d3.select(this).transition().duration(100).attr('r', 7);
                                const [mouseX, mouseY] = d3.pointer(event, targetsContainer);
                                tooltip
                                    .style('visibility', 'visible')
                                    .html(`Decision: ${target.decisionYear}<br/>Target: ${fmtVal(target.targetValue)}% by ${target.targetYear}`)
                                    .style('top', (mouseY + 10) + 'px')
                                    .style('left', (mouseX + 10) + 'px');
                            })
                            .on('mouseleave', function() {
                                d3.select(this).transition().duration(100).attr('r', 5);
                                tooltip.style('visibility', 'hidden');
                            });
                        
                        // For superseded targets, add label near start
                        if (endYear !== target.targetYear) {
                            g.append('text')
                                .attr('x', xScale(target.decisionYear) + 10)
                                .attr('y', yScale(target.targetValue))
                                .attr('dy', '0.35em')
                                .style('font-size', '10px')
                                .style('font-weight', '600')
                                .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                                .style('fill', climateColor)
                                .style('opacity', 0.7)
                                .text(`${fmtVal(target.targetValue)}%`);
                        }
                        
                        // End point - only if target reaches its actual deadline (not superseded)
                        if (endYear === target.targetYear) {
                            g.append('circle')
                                .attr('cx', xScale(target.targetYear))
                                .attr('cy', yScale(target.targetValue))
                                .attr('r', 6)
                                .style('fill', climateColor)
                                .style('stroke', '#fff')
                                .style('stroke-width', 2)
                                .style('cursor', 'pointer')
                                .on('mouseenter', function(event: any) {
                                    d3.select(this).transition().duration(100).attr('r', 8);
                                    const [mouseX, mouseY] = d3.pointer(event, targetsContainer);
                                    tooltip
                                        .style('visibility', 'visible')
                                        .html(`Target deadline: ${target.targetYear}<br/>Target: ${fmtVal(target.targetValue)}%`)
                                        .style('top', (mouseY + 10) + 'px')
                                        .style('left', (mouseX + 10) + 'px');
                                })
                                .on('mouseleave', function() {
                                    d3.select(this).transition().duration(100).attr('r', 6);
                                    tooltip.style('visibility', 'hidden');
                                });
                            
                            // Label at end point
                            g.append('text')
                                .attr('x', xScale(target.targetYear) + 10)
                                .attr('y', yScale(target.targetValue))
                                .attr('dy', '0.35em')
                                .style('font-size', '10px')
                                .style('font-weight', '600')
                                .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                                .style('fill', climateColor)
                                .text(`${fmtVal(target.targetValue)}%`);
                        }
                    });
                } else {
                    leftContainer.innerHTML = `
                        <div style="display:flex;align-items:center;justify-content:center;height:100%;">
                            <div style="text-align:center;color:#64748b;padding:20px;">
                                <div style="font-size:14px;font-weight:600;margin-bottom:4px;">No Climate Targets Data</div>
                                <div style="font-size:12px;">No climate targets found for ${countryName}</div>
                            </div>
                        </div>`;
                }
            } else if (!isEvMode && leftContainer && countryTargets.length > 0) {
                const targetsContainer = leftContainer as HTMLElement;
                const rect = targetsContainer.getBoundingClientRect();
                const citationHeight = 60; // Reserve space for citation
                const margin = { top: 40, right: 60, bottom: 20, left: 60 };
                const width = rect.width - margin.left - margin.right;
                const height = rect.height - margin.top - margin.bottom - citationHeight;
                
                const svg = d3.select(targetsContainer).append('svg')
                    .attr('width', rect.width)
                    .attr('height', rect.height - citationHeight)
                    .style('background', '#f8fafc')
                    .style('border-radius', '12px');
                addLogoWatermark(svg as any, rect.width);

                const g = svg.append('g')
                    .attr('transform', `translate(${margin.left}, ${margin.top})`);

                // Create custom tooltip for instant display
                const tooltip = d3.select(targetsContainer).append('div')
                    .attr('class', 'target-tooltip')
                    .style('position', 'absolute')
                    .style('visibility', 'hidden')
                    .style('background', 'rgba(0, 0, 0, 0.9)')
                    .style('color', '#fff')
                    .style('padding', '6px 10px')
                    .style('border-radius', '4px')
                    .style('font-size', '11px')
                    .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                    .style('pointer-events', 'none')
                    .style('z-index', '10000')
                    .style('white-space', 'nowrap')
                    .style('box-shadow', '0 2px 4px rgba(0, 0, 0, 0.2)');

                // Chart title
                svg.append('text')
                    .attr('x', rect.width / 2)
                    .attr('y', 20)
                    .style('text-anchor', 'middle')
                    .style('font-size', '15px')
                    .style('font-weight', '700')
                    .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                    .style('fill', '#1e293b')
                    .text('Renewable Energy Targets Progression');

                // Determine the year range
                const allYears = countryTargets.flatMap((t: any) => [t.decisionYear, t.targetYear]);
                const minYear = Math.min(...allYears);
                const maxYear = Math.max(...allYears);
                const yearPadding = Math.max(2, Math.ceil((maxYear - minYear) * 0.1));
                
                // Scales
                const xScale = d3.scaleLinear()
                    .domain([minYear - yearPadding, maxYear + yearPadding])
                    .range([0, width]);
                
                const yScale = d3.scaleLinear()
                    .domain([0, 100])
                    .range([height, 0]);
                
                // Grid lines
                const gridGroup = g.append('g').attr('class', 'grid');
                
                // Horizontal grid lines
                gridGroup.selectAll('.grid-h')
                    .data(yScale.ticks(5))
                    .enter().append('line')
                    .attr('class', 'grid-h')
                    .attr('x1', 0)
                    .attr('x2', width)
                    .attr('y1', d => yScale(d))
                    .attr('y2', d => yScale(d))
                    .style('stroke', '#e2e8f0')
                    .style('stroke-dasharray', '3,3')
                    .style('opacity', 0.5);
                
                // Axes
                const xAxis = d3.axisBottom(xScale)
                    .tickFormat(d => d3.format('d')(d as number))
                    .ticks(Math.min(8, maxYear - minYear));
                
                const yAxis = d3.axisLeft(yScale)
                    .tickFormat(d => `${d}%`)
                    .ticks(5);
                
                g.append('g')
                    .attr('transform', `translate(0, ${height})`)
                    .call(xAxis)
                    .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                    .style('font-size', '11px')
                    .style('color', '#64748b');
                
                g.append('g')
                    .call(yAxis)
                    .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                    .style('font-size', '11px')
                    .style('color', '#64748b');
                
                // Axis labels
                g.append('text')
                    .attr('x', width / 2)
                    .attr('y', height + 45)
                    .style('text-anchor', 'middle')
                    .style('font-size', '12px')
                    .style('font-weight', '600')
                    .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                    .style('fill', '#475569')
                    .text('Year');
                
                g.append('text')
                    .attr('transform', 'rotate(-90)')
                    .attr('x', -height / 2)
                    .attr('y', -45)
                    .style('text-anchor', 'middle')
                    .style('font-size', '12px')
                    .style('font-weight', '600')
                    .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                    .style('fill', '#475569')
                    .text('Target (%)');
                
                // Determine which target types should be visible initially.
                const allTargetTypes = Array.from(new Set(countryTargets.map((t: any) => t.targetType)));
                const defaultVisibleType = currentMapType === 'targets' && allTargetTypes.includes(currentTargetType)
                    ? currentTargetType
                    : (allTargetTypes.find((type: any) => String(type).toLowerCase().includes('electric')) || allTargetTypes[0]);
                const initiallyVisibleTypes = new Set(defaultVisibleType ? [defaultVisibleType] : []);
                
                // Helper function to check if a target type should be initially visible
                const shouldBeVisible = (targetType: string) => initiallyVisibleTypes.has(targetType);
                
                // Color scale for different target types
                const targetTypeColors = d3.scaleOrdinal()
                    .domain(allTargetTypes as string[])
                    .range(['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#ef4444']);
                
                // Sort targets by target type and decision year for proper connection
                const sortedTargets = [...countryTargets].sort((a: any, b: any) => {
                    if (a.targetType !== b.targetType) {
                        return a.targetType.localeCompare(b.targetType);
                    }
                    return a.decisionYear - b.decisionYear;
                });
                
                // Group targets by type to find connections
                const targetsByType: { [key: string]: any[] } = {};
                sortedTargets.forEach((target: any) => {
                    if (!targetsByType[target.targetType]) {
                        targetsByType[target.targetType] = [];
                    }
                    targetsByType[target.targetType].push(target);
                });
                
                // Draw lines for each target (horizontal lines at target level)
                sortedTargets.forEach((target: any, index: number) => {
                    const color = targetTypeColors(target.targetType) as string;
                    
                    // Check if this target is superseded by a later target of the same type
                    // A target is ONLY superseded if the new target is for the SAME or EARLIER target year
                    // (if the new target is for a LATER year, they coexist as part of a roadmap)
                    const sameTypeTargets = targetsByType[target.targetType] || [];
                    const targetIndex = sameTypeTargets.findIndex((t: any) => 
                        t.decisionYear === target.decisionYear && t.targetValue === target.targetValue
                    );
                    
                    // Find the next target that actually supersedes this one (SAME target year only)
                    // Different target years coexist as milestones (e.g., 2020 target and 2050 target are both valid)
                    let nextTarget = null;
                    for (let i = targetIndex + 1; i < sameTypeTargets.length; i++) {
                        const candidate = sameTypeTargets[i];
                        // Only consider it a superseding target if it's for the SAME target year
                        if (candidate.targetYear === target.targetYear) {
                            nextTarget = candidate;
                            break;
                        }
                    }
                    
                    // If there's a superseding target announced before this one's deadline, end the line there
                    const endYear = (nextTarget && nextTarget.decisionYear < target.targetYear) 
                        ? nextTarget.decisionYear 
                        : target.targetYear;
                    
                    // Draw horizontal line from decision year to end year at the target value level
                    const lineTooltipText = `${fmt1(target.targetValue)}% target from ${target.decisionYear} to ${endYear}${endYear !== target.targetYear ? ` (superseded, original deadline: ${target.targetYear})` : ''}`;
                    g.append('line')
                        .attr('class', `target-line target-type-${target.targetType.replace(/[^a-zA-Z0-9]/g, '-')}`)
                        .attr('data-target-type', target.targetType)
                        .attr('x1', xScale(target.decisionYear))
                        .attr('x2', xScale(endYear))
                        .attr('y1', yScale(target.targetValue))
                        .attr('y2', yScale(target.targetValue))
                        .style('stroke', color)
                        .style('stroke-width', 3)
                        .style('opacity', shouldBeVisible(target.targetType) ? 0.8 : 0)
                        .style('pointer-events', shouldBeVisible(target.targetType) ? 'auto' : 'none')
                        .style('cursor', 'pointer')
                        .on('mouseenter', function(event: any) {
                            const [mouseX, mouseY] = d3.pointer(event, targetsContainer);
                            tooltip
                                .style('visibility', 'visible')
                                .html(lineTooltipText.replace(/\n/g, '<br/>'))
                                .style('top', (mouseY + 10) + 'px')
                                .style('left', (mouseX + 10) + 'px');
                        })
                        .on('mousemove', function(event: any) {
                            const [mouseX, mouseY] = d3.pointer(event, targetsContainer);
                            tooltip
                                .style('top', (mouseY + 10) + 'px')
                                .style('left', (mouseX + 10) + 'px');
                        })
                        .on('mouseleave', function() {
                            tooltip.style('visibility', 'hidden');
                        });
                    
                    // If this target was superseded by a same-year target, draw a vertical dashed line connecting them
                    if (nextTarget && endYear !== target.targetYear) {
                        const connectionTooltip = `Target for ${target.targetYear} updated in ${nextTarget.decisionYear}<br/>From ${fmt1(target.targetValue)}% to ${fmt1(nextTarget.targetValue)}%`;
                        g.append('line')
                            .attr('class', `target-line-connection target-type-${target.targetType.replace(/[^a-zA-Z0-9]/g, '-')}`)
                            .attr('data-target-type', target.targetType)
                            .attr('x1', xScale(endYear))
                            .attr('x2', xScale(endYear))
                            .attr('y1', yScale(target.targetValue))
                            .attr('y2', yScale(nextTarget.targetValue))
                            .style('stroke', color)
                            .style('stroke-width', 2)
                            .style('stroke-dasharray', '4,3')
                            .style('opacity', shouldBeVisible(target.targetType) ? 0.6 : 0)
                            .style('pointer-events', shouldBeVisible(target.targetType) ? 'auto' : 'none')
                            .style('cursor', 'pointer')
                            .on('mouseenter', function(event: any) {
                                const [mouseX, mouseY] = d3.pointer(event, targetsContainer);
                                tooltip
                                    .style('visibility', 'visible')
                                    .html(connectionTooltip)
                                    .style('top', (mouseY + 10) + 'px')
                                    .style('left', (mouseX + 10) + 'px');
                            })
                            .on('mousemove', function(event: any) {
                                const [mouseX, mouseY] = d3.pointer(event, targetsContainer);
                                tooltip
                                    .style('top', (mouseY + 10) + 'px')
                                    .style('left', (mouseX + 10) + 'px');
                            })
                            .on('mouseleave', function() {
                                tooltip.style('visibility', 'hidden');
                            });
                    }
                    
                    // Draw start point (decision year) - when target was announced
                    g.append('circle')
                        .attr('class', `target-circle target-type-${target.targetType.replace(/[^a-zA-Z0-9]/g, '-')}`)
                        .attr('data-target-type', target.targetType)
                        .attr('cx', xScale(target.decisionYear))
                        .attr('cy', yScale(target.targetValue))
                        .attr('r', 5)
                        .style('fill', color)
                        .style('stroke', '#fff')
                        .style('stroke-width', 2)
                        .style('opacity', shouldBeVisible(target.targetType) ? 1 : 0)
                        .style('pointer-events', shouldBeVisible(target.targetType) ? 'auto' : 'none')
                        .style('cursor', 'pointer')
                        .on('mouseenter', function(event: any) {
                            d3.select(this).transition().duration(100).attr('r', 7);
                            const [mouseX, mouseY] = d3.pointer(event, targetsContainer);
                            tooltip
                                .style('visibility', 'visible')
                                        .html(`Decision: ${target.decisionYear}<br/>Target: ${fmt1(target.targetValue)}% by ${target.targetYear}`)
                                .style('top', (mouseY + 10) + 'px')
                                .style('left', (mouseX + 10) + 'px');
                        })
                        .on('mousemove', function(event: any) {
                            const [mouseX, mouseY] = d3.pointer(event, targetsContainer);
                            tooltip
                                .style('top', (mouseY + 10) + 'px')
                                .style('left', (mouseX + 10) + 'px');
                        })
                        .on('mouseleave', function() {
                            d3.select(this).transition().duration(100).attr('r', 5);
                            tooltip.style('visibility', 'hidden');
                        });
                    
                    // For superseded targets, add label near the start point (since there's no end circle)
                    if (endYear !== target.targetYear) {
                        g.append('text')
                            .attr('class', `target-label target-type-${target.targetType.replace(/[^a-zA-Z0-9]/g, '-')}`)
                            .attr('data-target-type', target.targetType)
                            .attr('x', xScale(target.decisionYear) + 10)
                            .attr('y', yScale(target.targetValue))
                            .attr('dy', '0.35em')
                            .style('font-size', '10px')
                            .style('font-weight', '600')
                            .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                            .style('fill', color)
                            .style('opacity', shouldBeVisible(target.targetType) ? 0.7 : 0)
                            .style('pointer-events', shouldBeVisible(target.targetType) ? 'auto' : 'none')
                            .text(`${fmt1(target.targetValue)}%`);
                    }
                    
                    // If target was superseded, draw a thin dashed line showing where it was originally headed
                    // BUT only if the superseding target has an EARLIER target year
                    // (if the new target covers the same or later year, no need for dashed line - it's "absorbed")
                    const shouldDrawDashedLine = endYear !== target.targetYear && 
                        (!nextTarget || nextTarget.targetYear < target.targetYear);
                    
                    if (shouldDrawDashedLine) {
                        const originalTargetTooltip = `Original target: ${fmt1(target.targetValue)}% by ${target.targetYear}<br/>(Superseded in ${endYear})`;
                        g.append('line')
                            .attr('class', `target-line-dashed target-type-${target.targetType.replace(/[^a-zA-Z0-9]/g, '-')}`)
                            .attr('data-target-type', target.targetType)
                            .attr('x1', xScale(endYear))
                            .attr('x2', xScale(target.targetYear))
                            .attr('y1', yScale(target.targetValue))
                            .attr('y2', yScale(target.targetValue))
                            .style('stroke', color)
                            .style('stroke-width', 1.5)
                            .style('stroke-dasharray', '4,3')
                            .style('opacity', shouldBeVisible(target.targetType) ? 0.4 : 0)
                            .style('pointer-events', shouldBeVisible(target.targetType) ? 'auto' : 'none')
                            .style('cursor', 'pointer')
                            .on('mouseenter', function(event: any) {
                                const [mouseX, mouseY] = d3.pointer(event, targetsContainer);
                                tooltip
                                    .style('visibility', 'visible')
                                    .html(originalTargetTooltip)
                                    .style('top', (mouseY + 10) + 'px')
                                    .style('left', (mouseX + 10) + 'px');
                            })
                            .on('mousemove', function(event: any) {
                                const [mouseX, mouseY] = d3.pointer(event, targetsContainer);
                                tooltip
                                    .style('top', (mouseY + 10) + 'px')
                                    .style('left', (mouseX + 10) + 'px');
                            })
                            .on('mouseleave', function() {
                                tooltip.style('visibility', 'hidden');
                            });
                        
                        // Add a small marker at the original target year
                        g.append('circle')
                            .attr('class', `target-circle-original target-type-${target.targetType.replace(/[^a-zA-Z0-9]/g, '-')}`)
                            .attr('data-target-type', target.targetType)
                            .attr('cx', xScale(target.targetYear))
                            .attr('cy', yScale(target.targetValue))
                            .attr('r', 3)
                            .style('fill', 'none')
                            .style('stroke', color)
                            .style('stroke-width', 1.5)
                            .style('stroke-dasharray', '2,2')
                            .style('opacity', shouldBeVisible(target.targetType) ? 0.5 : 0)
                            .style('pointer-events', shouldBeVisible(target.targetType) ? 'auto' : 'none')
                            .style('cursor', 'pointer')
                            .on('mouseenter', function(event: any) {
                                const [mouseX, mouseY] = d3.pointer(event, targetsContainer);
                                tooltip
                                    .style('visibility', 'visible')
                                    .html(originalTargetTooltip)
                                    .style('top', (mouseY + 10) + 'px')
                                    .style('left', (mouseX + 10) + 'px');
                            })
                            .on('mousemove', function(event: any) {
                                const [mouseX, mouseY] = d3.pointer(event, targetsContainer);
                                tooltip
                                    .style('top', (mouseY + 10) + 'px')
                                    .style('left', (mouseX + 10) + 'px');
                            })
                            .on('mouseleave', function() {
                                tooltip.style('visibility', 'hidden');
                            });
                    }
                    
                    // Draw end point ONLY if target reaches its actual deadline (not superseded)
                    // This prevents misleading dots at supersede years that look like decisions
                    if (endYear === target.targetYear) {
                        const endTooltipText = `Target deadline: ${target.targetYear}<br/>Target: ${fmt1(target.targetValue)}%`;
                        g.append('circle')
                            .attr('class', `target-circle target-type-${target.targetType.replace(/[^a-zA-Z0-9]/g, '-')}`)
                            .attr('data-target-type', target.targetType)
                            .attr('cx', xScale(endYear))
                            .attr('cy', yScale(target.targetValue))
                            .attr('r', 6)
                            .style('fill', color)
                            .style('stroke', '#fff')
                            .style('stroke-width', 2)
                            .style('opacity', shouldBeVisible(target.targetType) ? 1 : 0)
                            .style('pointer-events', shouldBeVisible(target.targetType) ? 'auto' : 'none')
                            .style('cursor', 'pointer')
                            .on('mouseenter', function(event: any) {
                                d3.select(this).transition().duration(100).attr('r', 8);
                                const [mouseX, mouseY] = d3.pointer(event, targetsContainer);
                                tooltip
                                    .style('visibility', 'visible')
                                    .html(endTooltipText)
                                    .style('top', (mouseY + 10) + 'px')
                                    .style('left', (mouseX + 10) + 'px');
                            })
                            .on('mousemove', function(event: any) {
                                const [mouseX, mouseY] = d3.pointer(event, targetsContainer);
                                tooltip
                                    .style('top', (mouseY + 10) + 'px')
                                    .style('left', (mouseX + 10) + 'px');
                            })
                            .on('mouseleave', function() {
                                d3.select(this).transition().duration(100).attr('r', 6);
                                tooltip.style('visibility', 'hidden');
                            });
                        
                        // Add label at end point with target value
                        g.append('text')
                            .attr('class', `target-label target-type-${target.targetType.replace(/[^a-zA-Z0-9]/g, '-')}`)
                            .attr('data-target-type', target.targetType)
                            .attr('x', xScale(endYear) + 10)
                            .attr('y', yScale(target.targetValue))
                            .attr('dy', '0.35em')
                            .style('font-size', '10px')
                            .style('font-weight', '600')
                            .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                            .style('fill', color)
                            .style('opacity', shouldBeVisible(target.targetType) ? 1 : 0)
                            .style('pointer-events', shouldBeVisible(target.targetType) ? 'auto' : 'none')
                            .text(`${fmt1(target.targetValue)}%`);
                    }
                });
                
                // Legend with interactive filtering
                const legend = svg.append('g')
                    .attr('transform', `translate(${margin.left + 10}, ${margin.top + 10})`);
                
                const uniqueTargetTypes = allTargetTypes;
                
                // Track which target types are visible.
                const visibleTargetTypes = initiallyVisibleTypes;
                
                uniqueTargetTypes.forEach((targetType: any, i: number) => {
                    const isInitiallyVisible = visibleTargetTypes.has(targetType);
                    
                    const legendRow = legend.append('g')
                        .attr('transform', `translate(0, ${i * 22})`)
                        .style('cursor', 'pointer')
                        .attr('class', 'legend-item')
                        .attr('data-target-type', targetType);
                    
                    // Add background rect for better click area and hover effect
                    const bgRect = legendRow.append('rect')
                        .attr('x', -5)
                        .attr('y', -10)
                        .attr('width', 180)
                        .attr('height', 20)
                        .attr('rx', 4)
                        .style('fill', 'transparent')
                        .style('transition', 'all 0.2s ease');
                    
                    const legendLine = legendRow.append('line')
                        .attr('x1', 0)
                        .attr('x2', 20)
                        .attr('y1', 0)
                        .attr('y2', 0)
                        .style('stroke', targetTypeColors(targetType) as string)
                        .style('stroke-width', 3)
                        .style('opacity', isInitiallyVisible ? '1' : '0.3')
                        .style('transition', 'opacity 0.3s ease');
                    
                    const legendText = legendRow.append('text')
                        .attr('x', 25)
                        .attr('y', 0)
                        .attr('dy', '0.35em')
                        .style('font-size', '11px')
                        .style('font-weight', isInitiallyVisible ? '500' : '400')
                        .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                        .style('fill', '#334155')
                        .style('opacity', isInitiallyVisible ? '1' : '0.4')
                        .style('text-decoration', isInitiallyVisible ? 'none' : 'line-through')
                        .style('transition', 'all 0.3s ease')
                        .text(() => {
                            const full = getTargetTypeDisplayName(String(targetType));
                            const base = full
                                .replace(/^Renewable\s+/i, '')
                                .replace(/\s*Target$/i, '');
                            // Shorten long labels
                            return base
                                .replace(/\bHeating And Cooling\b/i, 'Heating & Cooling')
                                .replace(/\bTransportation\b/i, 'Transport');
                        });
                    
                    // Hover effects
                    legendRow
                        .on('mouseenter', function() {
                            if (visibleTargetTypes.has(targetType)) {
                                bgRect.style('fill', '#f1f5f9');
                                legendText.style('font-weight', '600');
                            }
                        })
                        .on('mouseleave', function() {
                            bgRect.style('fill', 'transparent');
                            if (visibleTargetTypes.has(targetType)) {
                                legendText.style('font-weight', '500');
                            }
                        })
                        .on('click', function() {
                            // Toggle visibility
                            if (visibleTargetTypes.has(targetType)) {
                                visibleTargetTypes.delete(targetType);
                                legendLine.style('opacity', '0.3');
                                legendText
                                    .style('opacity', '0.4')
                                    .style('text-decoration', 'line-through')
                                    .style('font-weight', '400');
                            } else {
                                visibleTargetTypes.add(targetType);
                                legendLine.style('opacity', '1');
                                legendText
                                    .style('opacity', '1')
                                    .style('text-decoration', 'none')
                                    .style('font-weight', '500');
                            }
                            
                            // Update chart visibility
                            updateChartVisibility();
                        });
                });
                
                // Function to update chart elements visibility based on selected target types
                function updateChartVisibility() {
                    // Update all horizontal target lines
                    g.selectAll('.target-line').each(function() {
                        const line = d3.select(this);
                        const targetType = line.attr('data-target-type');
                        const isVisible = visibleTargetTypes.has(targetType);
                        const isDashed = line.style('stroke-dasharray') !== 'none';
                        
                        line.transition()
                            .duration(300)
                            .style('opacity', isVisible ? (isDashed ? '0.6' : '0.8') : '0')
                            .style('pointer-events', isVisible ? 'auto' : 'none');
                    });
                    
                    // Update dashed lines showing original target years for superseded targets
                    g.selectAll('.target-line-dashed').each(function() {
                        const line = d3.select(this);
                        const targetType = line.attr('data-target-type');
                        const isVisible = visibleTargetTypes.has(targetType);
                        
                        line.transition()
                            .duration(300)
                            .style('opacity', isVisible ? '0.4' : '0')
                            .style('pointer-events', isVisible ? 'auto' : 'none');
                    });
                    
                    // Update connection lines (vertical dashed lines for same-year supersessions)
                    g.selectAll('.target-line-connection').each(function() {
                        const line = d3.select(this);
                        const targetType = line.attr('data-target-type');
                        const isVisible = visibleTargetTypes.has(targetType);
                        
                        line.transition()
                            .duration(300)
                            .style('opacity', isVisible ? '0.6' : '0')
                            .style('pointer-events', isVisible ? 'auto' : 'none');
                    });
                    
                    // Update circles - keep radius constant to preserve tooltips
                    g.selectAll('.target-circle').each(function() {
                        const circle = d3.select(this);
                        const targetType = circle.attr('data-target-type');
                        const isVisible = visibleTargetTypes.has(targetType);
                        
                        circle.transition()
                            .duration(300)
                            .style('opacity', isVisible ? '1' : '0')
                            .style('pointer-events', isVisible ? 'auto' : 'none');
                    });
                    
                    // Update original target markers (small dashed circles at original target years)
                    g.selectAll('.target-circle-original').each(function() {
                        const circle = d3.select(this);
                        const targetType = circle.attr('data-target-type');
                        const isVisible = visibleTargetTypes.has(targetType);
                        
                        circle.transition()
                            .duration(300)
                            .style('opacity', isVisible ? '0.5' : '0')
                            .style('pointer-events', isVisible ? 'auto' : 'none');
                    });
                    
                    // Update labels
                    g.selectAll('.target-label').each(function() {
                        const text = d3.select(this);
                        const targetType = text.attr('data-target-type');
                        const isVisible = visibleTargetTypes.has(targetType);
                        
                        text.transition()
                            .duration(300)
                            .style('opacity', isVisible ? '1' : '0')
                            .style('pointer-events', isVisible ? 'auto' : 'none');
                    });
                }
                
                // Add instruction text
                legend.append('text')
                    .attr('x', 0)
                    .attr('y', uniqueTargetTypes.length * 22 + 10)
                    .style('font-size', '9px')
                    .style('font-style', 'italic')
                    .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                    .style('fill', '#94a3b8')
                    .text('Click to show/hide target types');

                // Add Citation
                d3.select(targetsContainer).append('div')
                    .style('flex', '0 0 auto') // Don't grow or shrink
                    .style('padding', '10px 20px')
                    .style('font-size', '9px')
                    .style('color', '#64748b')
                    .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                    .style('line-height', '1.4')
                    .style('max-width', '100%')
                    .style('background', '#f8fafc') // Match container background
                    .html(`<strong>Suggested Citation:</strong> ${CITATION_TARGETS}`);

                // Removed per-chart overlay in favor of single dashboard overlay
            } else if (leftContainer && !isEvMode && !isClimateTargetsMode) {
                // Only show "no RE targets" message for RE Support and Renewables Targets modes
                leftContainer.innerHTML = `
                    <div style="display:flex;align-items:center;justify-content:center;height:100%;">
                        <div style="text-align:center;color:#64748b;padding:20px;">
                            <div style="font-size:14px;font-weight:600;margin-bottom:4px;">No Targets Data</div>
                            <div style="font-size:12px;">No renewable energy targets found for ${countryName}</div>
                        </div>
                    </div>`;
            }

            // Time series chart: row-per-policy type (non-stacked)
            // Use EV data if in EV mode, otherwise use policy data
            const tsContainer = document.getElementById('dashboard-timeseries');
            const evTimeSeries = allData.ev.timeSeriesData || {};
            const countryEvTime = evTimeSeries[countryCode3];
            const countryTime = isEvMode ? countryEvTime : timeSeriesData[countryCode3];
            const timeSeriesColorScale = isEvMode ? allData.ev.globalColorScale : globalColorScale;
            const chartTitle = isEvMode ? 'EV Support Policy Timeline' : 'Policy Timeline by Type';
            const noDataTitle = isEvMode ? 'No EV Timeline Data' : 'No Policy Timeline Data';
            const noDataSubtitle = isEvMode ? `No EV support time series found for ${countryName}` : `No policy time series found for ${countryName}`;
            
            if (tsContainer) tsContainer.innerHTML = '';
            if (tsContainer && countryTime) {
                // Allow positioned overlays inside the container
                (tsContainer as HTMLElement).style.position = 'relative';
                const allYears = Object.keys(countryTime).map(Number).sort();
                const yearly: { [year: number]: { [measure: string]: number } } = {};
                const types = new Set<string>();
                allYears.forEach(y => {
                    yearly[y] = {};
                    const yd = countryTime[y];
                    if (yd) {
                        Object.entries(yd).forEach(([m, c]) => { if ((c as number) > 0) { yearly[y][m] = 1; types.add(m); } });
                    }
                });
                const yearsWith = allYears.filter(y => Object.values(yearly[y] || {}).some(v => (v as number) > 0));
                if (yearsWith.length === 0) {
                    tsContainer.innerHTML = `
                        <div style="display:flex;align-items:center;justify-content:center;height:100%;">
                            <div style="text-align:center;color:#64748b;padding:20px;">
                                <div style="font-size:14px;font-weight:600;margin-bottom:4px;">${noDataTitle}</div>
                                <div style="font-size:12px;">${noDataSubtitle}</div>
                            </div>
                        </div>`;
                    return;
                }
                const startY = yearsWith[0];
                const endY = yearsWith[yearsWith.length - 1];
                const years = allYears.filter(y => y >= startY && y <= endY);

                const rect = tsContainer.getBoundingClientRect();
                const citationHeight = 60; // Reserve space for citation
                // Responsive margins for smaller screens
                const isSmallScreen = rect.width < 768;
                const margin = isSmallScreen 
                    ? { top: 30, right: 20, bottom: 20, left: 140 }
                    : { top: 40, right: 20, bottom: 20, left: 140 };
                const width = rect.width - margin.left - margin.right;
                const height = rect.height - margin.top - margin.bottom - citationHeight;
                const svg = d3.select(tsContainer).append('svg')
                    .attr('width', rect.width)
                    .attr('height', rect.height - citationHeight)
                    .style('border-radius', '12px')
                    .style('filter', 'drop-shadow(0 2px 8px rgba(0,0,0,0.06))');
                addLogoWatermark(svg as any, rect.width);

                const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
                // Chart title
                svg.append('text')
                    .attr('x', margin.left + width / 2)
                    .attr('y', Math.max(16, margin.top - 6))
                    .style('text-anchor', 'middle')
                    .style('font-size', '14px')
                    .style('font-weight', '600')
                    .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                    .style('fill', '#334155')
                    .text(chartTitle);

                // Removed per-chart overlay; handled at dashboard container level
                const x = d3.scaleBand().domain(years.map(String)).range([0, width]).padding(0.06);
                // Compute frequency of each policy type across selected years
                const policyFreq: Record<string, number> = {};
                Array.from(types).forEach(t => { policyFreq[t] = 0; });
                years.forEach(y => {
                    Array.from(types).forEach(t => { if (yearly[y][t]) policyFreq[t] += 1; });
                });
                // Sort types by ascending frequency so the most frequent ends up at the bottom
                const sortedPolicyTypes = Array.from(types).sort((a, b) => policyFreq[a] - policyFreq[b]);
                const yBand = d3.scaleBand().domain(sortedPolicyTypes).range([0, height]).padding(0.1);

                // (Removed) background row bands to keep bar chart clean

                // Grid
                const grid = g.append('g');
                grid.selectAll('.hline').data(sortedPolicyTypes).enter().append('line')
                    .attr('class', 'hline')
                    .attr('x1', 0).attr('x2', width)
                    .attr('y1', d => (yBand(d) || 0) + yBand.bandwidth()).attr('y2', d => (yBand(d) || 0) + yBand.bandwidth())
                    .style('stroke', '#e2e8f0').style('stroke-dasharray', '2,2').style('opacity', 0.2);
                grid.selectAll('.vline').data(years).enter().append('line')
                    .attr('class', 'vline')
                    .attr('y1', 0).attr('y2', height)
                    .attr('x1', d => (x(String(d)) || 0) + x.bandwidth()).attr('x2', d => (x(String(d)) || 0) + x.bandwidth())
                    .style('stroke', '#e2e8f0').style('stroke-dasharray', '2,2').style('opacity', 0.08);

                // Cells data: one per active measure-year
                const cells: { year: number; measure: string }[] = [];
                years.forEach(y => {
                    sortedPolicyTypes.forEach(m => { if (yearly[y][m]) cells.push({ year: y, measure: m }); });
                });

                // Track the currently open popup to enable toggle-close behavior
                let currentPopupKey: string | null = null;

                // Policy detail popup - handles both RE Support and EV Support modes
                function showPolicyDetailPopup(measure: string, year: number, rows: any[], isEv: boolean = false) {
                    const parent = document.getElementById('modal-content');
                    if (!parent) return;
                    parent.querySelectorAll('.policy-detail-popup').forEach(el => el.remove());
                    const box = document.createElement('div');
                    box.className = 'policy-detail-popup';
                    box.style.position = 'absolute';
                    // Responsive sizing: ~85% of content area on desktop, 95% on small screens
                    const parentRect = parent.getBoundingClientRect();
                    const isNarrow = parentRect.width < 768;
                    box.style.right = isNarrow ? 'auto' : '24px';
                    box.style.left = isNarrow ? '50%' : 'auto';
                    box.style.transform = isNarrow ? 'translateX(-50%)' : 'none';
                    box.style.bottom = isNarrow ? '16px' : '24px';
                    // Width: keep compact on desktop, full on mobile
                    box.style.width = isNarrow ? '95%' : 'auto';
                    box.style.maxWidth = isNarrow ? '95%' : '720px';
                    // Height: take up to ~85% of modal content height
                    box.style.maxHeight = '85%';
                    box.style.overflowY = 'auto';
                    box.style.background = 'rgba(255,255,255,0.95)';
                    box.style.border = '1px solid #e5e7eb';
                    box.style.borderRadius = '12px';
                    box.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)';
                    box.style.padding = isNarrow ? '12px' : '14px';
                    box.style.zIndex = '1000';
                    const title = document.createElement('div');
                    title.style.display = 'flex';
                    title.style.justifyContent = 'space-between';
                    title.style.alignItems = 'center';
                    title.style.marginBottom = '8px';
                    // Format measure for display: Title Case by default; if exactly FIT/TGC, use all caps
                    function formatPolicyTypeDisplay(m: string): string {
                        const mm = (m || '').trim();
                        if (!mm) return '';
                        const lower = mm.toLowerCase();
                        if (lower === 'fit') return 'FIT';
                        if (lower === 'tgc') return 'TGC';
                        return mm.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
                    }
                    const formattedMeasure = formatPolicyTypeDisplay(measure);
                    title.innerHTML = `<span style="font-weight:600; color:#111827; font-size:${isNarrow ? '14px' : '16px'};">${countryName} — ${formattedMeasure} (${year})</span>`;
                    const close = document.createElement('button');
                    close.textContent = '×';
                    close.style.fontSize = '18px';
                    close.style.color = '#6b7280';
                    close.style.border = 'none';
                    close.style.background = 'none';
                    close.style.cursor = 'pointer';
                    close.onclick = () => {
                        box.remove();
                        // Clear any active popup key when closing via the close button
                        try { (currentPopupKey as any) = null; } catch {}
                    };
                    title.appendChild(close);
                    box.appendChild(title);
                    const list = document.createElement('div');
                    list.style.display = 'flex';
                    list.style.flexDirection = 'column';
                    list.style.gap = '8px';
                    const limited = rows.slice(0, 5);
                    if (limited.length === 0) {
                        list.innerHTML = `<div style="color:#6b7280">No specific policies matched.</div>`;
                    } else {
                        limited.forEach(r => {
                            const item = document.createElement('div');
                            item.style.padding = isNarrow ? '8px' : '10px';
                            item.style.borderRadius = '8px';
                            item.style.background = '#f9fafb';
                            item.style.border = '1px solid #e5e7eb';
                            // Robust field accessor: try exact match, then case-insensitive match
                            const f = (name: string) => {
                                if (r[name] !== undefined) return r[name];
                                const key = Object.keys(r).find(k => k.trim().toLowerCase() === name.trim().toLowerCase());
                                return key ? r[key] : '';
                            };
                            
                            if (isEv) {
                                // EV Support mode: use level_1 and instrument_level1_unit
                                const level1Val = String(f('level_1') || '').trim() || '-';
                                const unit1Raw = String(f('instrument_level1_unit') || '').trim();
                                const unit1Val = unit1Raw ? unit1Raw.charAt(0).toUpperCase() + unit1Raw.slice(1) : '-';
                                const techType = String(f('Technology_type') || '').trim() || '-';
                                
                                item.innerHTML = `
                                    <div style="font-size:${isNarrow ? '11px' : '12px'}; color:#4b5563;">Technology: ${techType}</div>
                                    <div style="font-size:${isNarrow ? '11px' : '12px'}; color:#4b5563;">Level: ${level1Val}</div>
                                    <div style="font-size:${isNarrow ? '11px' : '12px'}; color:#4b5563;">Unit: ${unit1Val}</div>
                                `;
                            } else {
                                // RE Support mode: original logic
                                const titleVal = f('level_1') || '';
                                const currencyCodes = new Set([
                                    'eur','usd','gbp','chf','cad','aud','nok','sek','dkk','pln','czk','huf','ron','try','jpy','cny','inr','brl','rub','mxn','zar','ils','krw','sgd','hkd','thb','myr','idr','php','uah','bgn','isk','rsd','hrk','nzd','twd','cop','ars','clp','pen','qar','sar','aed','kwd','bhd','lkr','ngn','bdt','pkr','vnd','egp','mad','dzd','tnd','kes','ghs','tzs','ugx','xaf','xof','xpf'
                                ]);
                                const round3 = (m: string) => {
                                    const n = parseFloat(m);
                                    if (!isFinite(n)) return m;
                                    const v = Math.round(n * 1000) / 1000;
                                    return String(v);
                                };
                                const titleHtml = titleVal
                                    ? (() => {
                                        const base = String(titleVal).trim();
                                        if (!base) return '-';
                                        const rounded = base.replace(/(?<![\w-])(-?\d*\.?\d+)(?![\w-])/g, round3);
                                        return rounded.replace(/\b([a-z]{3})\b/g, (m, c) => currencyCodes.has(c) ? c.toUpperCase() : m);
                                    })()
                                    : '';
                                const formatCurrencyCode = (s: string) => String(s || '').trim() ? String(s || '').trim().toUpperCase() : '-';
                                const formatDetailText = (s: string) => {
                                    const base = String(s || '').trim();
                                    if (!base) return '-';
                                    const withRounded = base.replace(/(?<![\\w-])(-?\\d*\\.?\\d+)(?![\\w-])/g, round3);
                                    return withRounded.replace(/\\b([a-z]{3})\\b/g, (m, c) => currencyCodes.has(c) ? c.toUpperCase() : m);
                                };
                                const formatTechType = (s: string) => {
                                    const base = String(s || '').trim();
                                    if (!base) return '-';
                                    return base
                                        .replace(/[_-]+/g, ' ')
                                        .split(/\s+/)
                                        .map(w => /^[A-Z]{2,4}$/.test(w) ? w : (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
                                        .join(' ');
                                };
                                const currencyVal = formatCurrencyCode(f('level_1_currency') || '');
                                const percentDetailVal = formatDetailText(f('level_1_percent_type_detail') || '');
                                const unitValRaw = String(f('level_1_unit') || '').trim();
                                const unitDisplayVal = unitValRaw ? unitValRaw : percentDetailVal;
                                // Check if this is a soft loan to show interest rate
                                const isSoftLoan = measure.toLowerCase().includes('soft loan');
                                const loanInterestRateRaw = f('loan_interest_rate') || '';
                                const loanInterestRate = loanInterestRateRaw ? parseFloat(loanInterestRateRaw).toFixed(2) : '';
                                // Check if this is TGC to show TGC-specific fields
                                const isTGC = measure.toLowerCase() === 'tgc';
                                const tgcPriceCurrency = f('TGC_price_currency') || '';
                                const tgcPriceMaxRaw = f('TGC_price_max') || '';
                                const tgcPriceMinRaw = f('TGC_price_min') || '';
                                const tgcPriceMax = tgcPriceMaxRaw ? parseFloat(tgcPriceMaxRaw).toFixed(2) : '';
                                const tgcPriceMin = tgcPriceMinRaw ? parseFloat(tgcPriceMinRaw).toFixed(2) : '';
                                const tgcPriceUnit = f('TGC_price_unit') || '';
                                const tgcTargetLevelRaw = f('TGC_target_level') || '';
                                const tgcTargetLevel = tgcTargetLevelRaw ? parseFloat(tgcTargetLevelRaw).toFixed(2) : '';
                                const tgcTargetLevelUnit = f('TGC_target_level_unit') || '';
                                
                                let tgcHtml = '';
                                if (isTGC) {
                                    if (tgcPriceMin || tgcPriceMax) {
                                        const priceRange = tgcPriceMin && tgcPriceMax ? `${tgcPriceMin} - ${tgcPriceMax}` : (tgcPriceMin || tgcPriceMax);
                                        tgcHtml += `<div style="font-size:${isNarrow ? '11px' : '12px'}; color:#4b5563;">Price: ${priceRange}${tgcPriceCurrency ? ' ' + tgcPriceCurrency : ''}${tgcPriceUnit ? ' / ' + tgcPriceUnit : ''}</div>`;
                                    }
                                    if (tgcTargetLevel) {
                                        tgcHtml += `<div style="font-weight:600; color:#374151; font-size:${isNarrow ? '13px' : '14px'};">Target: ${tgcTargetLevel}${tgcTargetLevelUnit ? ' ' + tgcTargetLevelUnit : ''}</div>`;
                                    }
                                }
                                
                                // Check if this is a tender and show tender_amount_contracted if no level_1
                                const isTender = measure.toLowerCase().includes('tender');
                                let tenderHtml = '';
                                if (isTender && !titleVal) {
                                    const tenderAmount = f('tender_amount_contracted') || '';
                                    const tenderUnit = (f('tender_amount_contracted_unit') || '').toLowerCase();
                                    if (tenderAmount) {
                                        let amount = parseFloat(tenderAmount);
                                        let displayUnit = tenderUnit;
                                        // Convert kW to MW
                                        if (tenderUnit === 'kw') {
                                            amount = amount / 1000;
                                            displayUnit = 'MW';
                                        } else if (tenderUnit === 'mw') {
                                            displayUnit = 'MW';
                                        }
                                        const formattedAmount = amount.toFixed(2);
                                        tenderHtml = `<div style="font-size:${isNarrow ? '11px' : '12px'}; color:#4b5563;">Tendered amount: ${formattedAmount}${displayUnit ? ' ' + displayUnit : ''}</div>`;
                                    }
                                }
                                
                                item.innerHTML = `
                                    ${tgcHtml}
                                    ${titleHtml ? `<div style="font-weight:600; color:#374151; font-size:${isNarrow ? '13px' : '14px'};">${titleHtml}</div>` : ''}
                                    <div style="font-size:${isNarrow ? '11px' : '12px'}; color:#4b5563;">Tech: ${formatTechType(f('Technology_type') || '')}</div>
                                    ${currencyVal && currencyVal !== '-' ? `<div style="font-size:${isNarrow ? '11px' : '12px'}; color:#4b5563;">Currency: ${currencyVal}</div>` : ''}
                                    ${unitDisplayVal ? `<div style="font-size:${isNarrow ? '11px' : '12px'}; color:#4b5563;">Unit: ${unitDisplayVal}</div>` : ''}
                                    ${isSoftLoan && loanInterestRate ? `<div style="font-size:${isNarrow ? '11px' : '12px'}; color:#4b5563;">Interest Rate: ${loanInterestRate}%</div>` : ''}
                                    ${tenderHtml}
                                `;
                            }
                            list.appendChild(item);
                        });
                    }
                    box.appendChild(list);
                    // Allow closing the popup by clicking anywhere on the panel
                    box.addEventListener('click', () => {
                        box.remove();
                        try { (currentPopupKey as any) = null; } catch {}
                    });
                    parent.appendChild(box);
                }

                // Cells (non-stacked) - use appropriate color scale based on mode
                const cellColorFn = isEvMode 
                    ? (measure: string) => timeSeriesColorScale(measure) as string
                    : (measure: string) => getMeasureColor(measure);
                
                g.selectAll('.policy-cell')
                    .data(cells)
                    .enter()
                    .append('rect')
                    .attr('class', 'policy-cell')
                    .attr('x', d => x(String(d.year)) || 0)
                    .attr('y', d => yBand(d.measure) || 0)
                    .attr('width', x.bandwidth())
                    .attr('height', yBand.bandwidth())
                    .attr('rx', 3).attr('ry', 3)
                    .attr('fill', d => cellColorFn(d.measure))
                    .style('opacity', 0.95)
                    .style('cursor', 'pointer')
                    .on('click', function(event, d: any) {
                        const measure = d.measure as string;
                        const year = Number(d.year);
                        const key = `${measure}-${year}`;
                        // If the same cell is clicked again and a popup exists, close it instead of reopening
                        const existingPopup = document.querySelector('.policy-detail-popup') as HTMLElement | null;
                        if (existingPopup && currentPopupKey === key) {
                            existingPopup.remove();
                            currentPopupKey = null;
                            return;
                        }
                        
                        // Filter from appropriate CSV based on mode
                        let rows: any[];
                        if (isEvMode) {
                            // EV mode: filter from evCsv using dynamic columns
                            rows = evCsv.filter((row: any) => {
                                const countryCodeRaw = row[evCountryCodeCol];
                                const m = row[evMeasureCol] || 'Unknown';
                                const introducedYear = Number(row[evYearCol]); 
                                const policyChangedDetail = String(row[evPolicyChangedDetailCol] || '').trim().toLowerCase();
                                
                                if (!countryCodeRaw) return false;
                                const code = String(countryCodeRaw).trim().toUpperCase();
                                if (policyChangedDetail !== 'introduced') return false;
                                if (code !== countryCode3 || m !== measure) return false;
                                // Show policies that are active in the clicked year (introduced on or before)
                                if (!Number.isFinite(introducedYear) || introducedYear > year) return false;
                                return true;
                            });
                        } else {
                            // RE Support mode: filter from policyCsv
                            // Get all rows for this country+measure, then find the most recent one at or before clicked year
                            const allMatchingRows = policyCsv.filter((row: any) => {
                                const cName = normalizePolicyCountryName(row[countryColumnName]);
                                const m = row[measureColumnName] || 'Unknown';
                                const code3 = countryNameMap[cName || ''];
                                return code3 === countryCode3 && m === measure;
                            });
                            // Find rows at or before the clicked year
                            // Show ALL rows that match the exact clicked year
                            rows = allMatchingRows.filter((row: any) => {
                                const rowYear = Number(row[yearColumnName]);
                                return Number.isFinite(rowYear) && rowYear === year;
                            });
                        }
                        showPolicyDetailPopup(measure, year, rows, isEvMode);
                        currentPopupKey = key;
                    })
                    .on('mouseover', function() {
                        d3.select(this)
                            .style('opacity', 1)
                            .style('stroke', 'rgba(17, 24, 39, 0.5)')
                            .style('stroke-width', 1.5)
                            .style('filter', 'saturate(1.6) contrast(1.15)');
                    })
                    .on('mouseout', function() {
                        d3.select(this)
                            .style('opacity', 0.95)
                            .style('stroke', null)
                            .style('stroke-width', 1)
                            .style('filter', 'none');
                    });

                // Axes
                const xDomainDash = x.domain();
                const stepDash = xDomainDash.length > 24 ? 3 : (xDomainDash.length > 14 ? 2 : 1);
                const xTicksDash = xDomainDash.filter((_, i) => i % stepDash === 0);
                const xAxisDash = g.append('g')
                    .attr('transform', `translate(0, ${height})`)
                    .call(d3.axisBottom(x).tickValues(xTicksDash).tickSize(0));
                const xLabelSize = width <= 420 ? '9px' : (width <= 560 ? '10px' : '12px');
                xAxisDash.selectAll('text')
                    .style('font-size', xLabelSize)
                    .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                    .style('fill', '#475569')
                    .style('text-anchor', 'middle')
                    .attr('dx', '0')
                    .attr('dy', '0');
                xAxisDash.select('.domain')
                    .style('stroke', '#e2e8f0')
                    .style('stroke-width', 1);
                const yAxisDash = g.append('g')
                    .call(d3.axisLeft(yBand).tickSize(0).tickFormat((d: any) => formatPolicyLabel(String(d))));
                yAxisDash.selectAll('text')
                    .style('font-size', '12px')
                    .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                    .style('fill', '#475569');
                yAxisDash.select('.domain')
                    .style('stroke', '#e2e8f0')
                    .style('stroke-width', 1);

                // Legend removed: y-axis labels suffice for identifying policy types

                // Axis labels (y-label removed for clarity)
                g.append('text')
                    .attr('transform', `translate(${width / 2}, ${height + margin.bottom - 5})`)
                    .style('text-anchor', 'middle')
                    .style('font-size', '12px')
                    .style('font-weight', '600')
                    .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                    .style('fill', '#475569')
                    .text('Year');

                // Add Citation
                d3.select(tsContainer).append('div')
                    .style('margin-top', '10px')
                    .style('padding', '0 20px 20px 20px')
                    .style('font-size', '9px')
                    .style('color', '#64748b')
                    .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
                    .style('line-height', '1.4')
                    .style('max-width', '100%')
                    .html(`<strong>Suggested Citation:</strong> ${isEvMode ? CITATION_EV : CITATION_POLICY}`);

            } else if (tsContainer) {
                // Show message when no time series data is available
                tsContainer.innerHTML = `
                    <div style="display:flex;align-items:center;justify-content:center;height:100%;">
                        <div style="text-align:center;color:#64748b;padding:20px;">
                            <div style="font-size:14px;font-weight:600;margin-bottom:4px;">${noDataTitle}</div>
                            <div style="font-size:12px;">${noDataSubtitle}</div>
                        </div>
                    </div>`;
            }

            const dashboardTop = document.getElementById('dashboard-top');
            if (dashboardTop && dashboardTop.querySelector('svg')) {
                const getDashboardSvgs = (): SVGSVGElement[] | null => {
                    const svgs: SVGSVGElement[] = [];
                    for (const panelId of ['dashboard-pie', 'dashboard-timeseries']) {
                        const panel = document.getElementById(panelId);
                        if (!panel || panel.style.display === 'none') continue;
                        const svg = panel.querySelector('svg');
                        if (svg && svg.getBoundingClientRect().width > 80) {
                            svgs.push(svg as SVGSVGElement);
                        }
                    }
                    return svgs.length > 0 ? svgs : null;
                };

                registerGraphDownloadMenu({
                    container: dashboardTop,
                    title: 'Download dashboard',
                    getExportLayout: () => {
                        const svgs = getDashboardSvgs();
                        if (!svgs || svgs.length !== 2) return 'vertical';
                        const layoutEl = document.getElementById('dashboard-top');
                        return layoutEl?.style.flexDirection === 'column' ? 'vertical' : 'horizontal';
                    },
                    getActiveSvgs: getDashboardSvgs,
                    getFilenameSlug: () => `${countryName.toLowerCase().replace(/\s+/g, '-')}-dashboard`,
                    getExportCaption: () => getDashboardExportCaption(countryName),
                    countryDataLabel: `Data for ${countryName}`,
                    onDownloadCountryData: () => downloadCountryData(countryCode3, countryName),
                    onDownloadDataset: downloadFullDataset,
                });
            }
        });
    }

    // Function to create time series chart for a specific country
    function createTimeSeriesChart(countryCode3: string, countryName: string) {
        const timeSeriesContainer = document.getElementById('time-series-chart')!;
        timeSeriesContainer.innerHTML = '';

        const countryTimeData = timeSeriesData[countryCode3];
        if (!countryTimeData || Object.keys(countryTimeData).length === 0) {
            timeSeriesContainer.innerHTML = '<div class="flex items-center justify-center h-full text-gray-500">No time series data available for this country.</div>';
            return;
        }

        // Get all years and measures
        const allYears = Object.keys(countryTimeData).map(Number).sort();
        const measures = new Set<string>();
        Object.entries(countryTimeData).forEach(([year, yearData]) => {
            Object.keys(yearData as { [key: string]: number }).forEach(measure => measures.add(measure));
        });

        // Create data for stacked bars - count only policies active in each specific year
        const yearlyData: { [year: number]: { [measure: string]: number } } = {};
        const allPolicyTypes = new Set<string>();

        // First build from all years, then crop to active window for this country
        allYears.forEach(year => {
            yearlyData[year] = {};
            
            // Count only policy types that are actually active in this specific year
             if (countryTimeData[year]) {
                 Object.entries(countryTimeData[year]).forEach(([measure, count]) => {
                     if ((count as number) > 0) {
                         yearlyData[year][measure] = 1; // Each policy type counts as 1
                         allPolicyTypes.add(measure);
                     }
                 });
             }
        });

        // Determine active window: from first year with any active measure to last
        const yearsWithActivity = allYears.filter(y => {
            const yd = yearlyData[y] || {};
            return Object.values(yd).some(v => (v as number) > 0);
        });

        if (yearsWithActivity.length === 0) {
            timeSeriesContainer.innerHTML = '<div class="flex items-center justify-center h-full text-gray-500">No active policy years for this country.</div>';
            return;
        }

        const earliestActiveYear = yearsWithActivity[0];
        const latestActiveYear = yearsWithActivity[yearsWithActivity.length - 1];
        const years = allYears.filter(y => y >= earliestActiveYear && y <= latestActiveYear);

        // Compute frequency per policy type across the active window
        const policyFreq: Record<string, number> = {};
        Array.from(allPolicyTypes).forEach(t => { policyFreq[t] = 0; });
        years.forEach(year => {
            Array.from(allPolicyTypes).forEach(t => { if (yearlyData[year][t]) policyFreq[t] += 1; });
        });
        // Sort ascending by frequency so the most frequent appears at the bottom row
        const sortedPolicyTypes = Array.from(allPolicyTypes).sort((a, b) => policyFreq[a] - policyFreq[b]);

        // Build presence cells per year-policy for non-stacked rows
        const cells: { year: number; measure: string }[] = [];
        years.forEach(year => {
            sortedPolicyTypes.forEach(measure => {
                if (yearlyData[year][measure]) cells.push({ year, measure });
            });
        });

        // Chart dimensions
        const margin = { top: 20, right: 70, bottom: 35, left: 100 };
        const chartWidth = 300 - margin.left - margin.right;
        const chartHeight = 160 - margin.top - margin.bottom;

        // Create SVG with modern styling
        const svg = d3.select(timeSeriesContainer)
            .append('svg')
            .attr('width', chartWidth + margin.left + margin.right)
            .attr('height', chartHeight + margin.top + margin.bottom)
            .style('cursor', 'pointer')
            .style('background', 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)')
            .style('border-radius', '12px')
            .style('box-shadow', '0 4px 20px rgba(0, 0, 0, 0.08)')
            .style('transition', 'all 0.3s ease')
            .on('mouseenter', function() {
                d3.select(this)
                    .style('box-shadow', '0 8px 30px rgba(0, 0, 0, 0.15)')
                    .style('transform', 'translateY(-2px)');
            })
            .on('mouseleave', function() {
                d3.select(this)
                    .style('box-shadow', '0 4px 20px rgba(0, 0, 0, 0.08)')
                    .style('transform', 'translateY(0px)');
            })
            .on('click', function() {
                // Convert to format expected by full screen chart
                const timeSeriesChartData = Array.from(allPolicyTypes).map(measure => ({
                    measure,
                    values: years.map(year => ({
                        year,
                        count: yearlyData[year]?.[measure] || 0
                    }))
                }));
                createFullScreenTimeSeriesChart(timeSeriesChartData, countryName, globalColorScale);
                openModal();
            });
        addLogoWatermark(svg as any, chartWidth + margin.left + margin.right);

        const g = svg.append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        // Scales
        const xScale = d3.scaleBand()
            .domain(years.map(String))
            .range([0, chartWidth])
            .padding(0.06);

        const yBand = d3.scaleBand()
            .domain(sortedPolicyTypes)
            .range([0, chartHeight])
            .padding(0.1);

        // Add modern grid lines
        const gridLines = g.append('g')
            .attr('class', 'grid-lines')
            .style('opacity', 0.2);

        // Horizontal grid lines
        gridLines.selectAll('.grid-line-horizontal')
            .data(sortedPolicyTypes)
            .enter().append('line')
            .attr('class', 'grid-line-horizontal')
            .attr('x1', 0)
            .attr('x2', chartWidth)
            .attr('y1', d => (yBand(d) || 0) + yBand.bandwidth())
            .attr('y2', d => (yBand(d) || 0) + yBand.bandwidth())
            .style('stroke', '#e2e8f0')
            .style('stroke-width', 1)
            .style('stroke-dasharray', '2,2');

        // Add axes with modern styling and adaptive tick density
        const xDomain = xScale.domain();
        const step = xDomain.length > 24 ? 3 : (xDomain.length > 14 ? 2 : 1);
        const xTicks = xDomain.filter((_, i) => i % step === 0);
        const xAxis = g.append('g')
            .attr('transform', `translate(0,${chartHeight})`)
            .call(d3.axisBottom(xScale).tickValues(xTicks).tickSize(0))
            .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif');

        xAxis.selectAll('text')
            .style('font-size', '11px')
            .style('font-weight', '500')
            .style('fill', '#64748b')
            .style('text-anchor', 'middle')
            .attr('dx', '0')
            .attr('dy', '0');

        xAxis.select('.domain')
            .style('stroke', '#e2e8f0')
            .style('stroke-width', 1);

        const yAxis = g.append('g')
            .call(d3.axisLeft(yBand).tickSize(0))
            .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif');

        yAxis.selectAll('text')
            .style('font-size', '11px')
            .style('font-weight', '500')
            .style('fill', '#64748b')
            .attr('dx', '-0.5em');

        yAxis.select('.domain')
            .style('stroke', '#e2e8f0')
            .style('stroke-width', 1);

        // Draw cells
        const cellsSel = g.selectAll('.policy-cell')
            .data(cells)
            .enter().append('rect')
            .attr('class', 'policy-cell')
            .attr('x', d => xScale(String(d.year))!)
            .attr('y', d => yBand(d.measure) || 0)
            .attr('width', xScale.bandwidth())
            .attr('height', yBand.bandwidth())
            .attr('rx', 3)
            .attr('ry', 3)
            .attr('fill', d => globalColorScale(d.measure as string) as string)
            .style('fill-opacity', 0.88)
            .style('stroke', 'rgba(255, 255, 255, 0.6)')
            .style('stroke-width', 1)
            .style('transition', 'all 0.3s ease')
            .style('cursor', 'pointer');

        // Hover effects
        cellsSel.on('mouseenter', function() {
                d3.select(this)
                    .style('filter', 'saturate(1.6) contrast(1.15)')
                    .style('stroke-width', 1.5)
                    .style('stroke', 'rgba(17, 24, 39, 0.5)');
            })
            .on('mouseleave', function() {
                d3.select(this)
                    .style('filter', 'none')
                    .style('stroke-width', 1)
                    .style('stroke', 'rgba(255, 255, 255, 0.6)');
            });

        // Legend removed: y-axis labels already show policy names

        // Add modern axis labels
        // Removed vertical y-axis label to declutter the small chart

        g.append('text')
            .attr('transform', `translate(${chartWidth / 2}, ${chartHeight + margin.bottom - 5})`)
            .style('text-anchor', 'middle')
            .style('font-size', '12px')
            .style('font-weight', '600')
            .style('font-family', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')
            .style('fill', '#475569')
            .style('opacity', 0)
            .text('Year')
            .transition()
            .duration(600)
            .delay(1200)
            .style('opacity', 1);
    }

    g.selectAll("path")
        .data(geoData.features)
        .enter().append("path")
        .attr("d", path as any)
        .attr("fill", (d: any) => getCountryColor(d.id))
        .attr("class", "country")
        .on("mouseover", function (event, d: any) {
            d3.select(this).style("stroke", "black").style("stroke-width", 1.5);
            const countryCode = d.id;
            const countryName = d.properties.name;

            tooltip.style("visibility", "visible")
                   .html(getTooltipContent(countryCode, countryName));
        })
        .on("mousemove", function (event) {
            tooltip.style("top", (event.pageY - 10) + "px")
                   .style("left", (event.pageX + 10) + "px");
        })
        .on("mouseout", function () {
            d3.select(this).style("stroke", null).style("stroke-width", null);
            tooltip.style("visibility", "hidden");
        })
        .on("click", function (event, d: any) {
            const countryCode3 = d.id;
            const countryName = d.properties.name;
            createCountryDashboardModal(countryCode3, countryName);
        });

    document.getElementById('close-panel')?.addEventListener('click', () => {
        document.getElementById('policy-panel')?.classList.remove('visible');
        document.getElementById('panel-backdrop')?.classList.remove('visible');
    });

    document.getElementById('panel-backdrop')?.addEventListener('click', () => {
        document.getElementById('policy-panel')?.classList.remove('visible');
        document.getElementById('panel-backdrop')?.classList.remove('visible');
    });

    g.selectAll("text.country-label")
        .data(geoData.features)
        .enter().append("text")
        .attr("class", "country-label")
        .attr("transform", (d: any) => {
            let centroid: [number, number];
            if (d.geometry.type === "Polygon") {
                const result = polylabel(d.geometry.coordinates);
                centroid = [result[0], result[1]];
            } else if (d.geometry.type === "MultiPolygon") {
                let bestPolygon = d.geometry.coordinates[0];
                let maxArea = 0;
                d.geometry.coordinates.forEach((polygon: any) => {
                    const area = d3.geoArea({ type: "Polygon", coordinates: polygon });
                    if (area > maxArea) {
                        maxArea = area;
                        bestPolygon = polygon;
                    }
                });
                const result = polylabel(bestPolygon);
                centroid = [result[0], result[1]];
            } else {
                const pCentroid = path.centroid(d);
                centroid = [pCentroid[0], pCentroid[1]];
            }

            if (isNaN(centroid[0]) || isNaN(centroid[1])) {
                return "translate(-9999, -9999)";
            }
            return `translate(${projection(centroid)})`;
        })
        .attr("text-anchor", "middle")
        .attr("font-size", "2px")
        .attr("fill", "black")
        .style("pointer-events", "none")
        .text((d: any) => countryCodeMapping[d.id] || "");

    // Add a legend
    const legendWidth = 300;
    const legendHeight = 20;
    const legend = svg.append("g")
        .attr("class", "legend")
        .attr("transform", `translate(20, ${height - 50})`);

    const defs = svg.append("defs");
    const linearGradient = defs.append("linearGradient")
        .attr("id", "gradient-color");

    const stops = d3.range(0, 1.01, 0.25).map(t => ({
        offset: `${t * 100}%`,
        color: d3.interpolateGreens(t)
    }));

    linearGradient.selectAll("stop")
        .data(stops)
        .enter().append("stop")
        .attr("offset", d => d.offset)
        .attr("stop-color", d => d.color);

    legend.append("rect")
        .attr("width", legendWidth)
        .attr("height", legendHeight)
        .style("fill", "url(#gradient-color)");

    legend.append("text")
        .attr("x", 0)
        .attr("y", legendHeight + 20)
        .style("font-size", "12px")
        .text(minPolicies as number);

    legend.append("text")
        .attr("x", legendWidth)
        .attr("y", legendHeight + 20)
        .style("text-anchor", "end")
        .style("font-size", "12px")
        .text(maxPolicies as number);
    
    const europeCenter: [number, number] = [5, 48]; // lon, lat for center of Western Europe
    const initialScale = 5;
    const initialTranslate = projection(europeCenter)!;

    svg.call(zoom.transform as any, d3.zoomIdentity
        .translate(width / 2 - initialTranslate[0] * initialScale, height / 2 - initialTranslate[1] * initialScale)
        .scale(initialScale));
        
    document.getElementById('world-map-container')?.classList.add('loaded');

    // Add event listeners for map type switching
    document.querySelectorAll('input[name="mapType"]').forEach(radio => {
        radio.addEventListener('change', (event) => {
            const target = event.target as HTMLInputElement;
            if (target.checked) {
                currentMapType = target.value as MapType;
                updateMap();
            }
        });
    });

    // Add event listeners for the new toggle switch
    const toggleSwitch = document.getElementById('mapTypeToggle');
    const toggleOptions = document.querySelectorAll('.toggle-option');
    
    if (toggleSwitch && toggleOptions.length > 0) {
        toggleOptions.forEach((option, index) => {
            option.addEventListener('click', () => {
                const values: MapType[] = ['policies', 'ev', 'targets', 'climateTargets', 'regulations'];
                const selectedValue = values[index];
                
                if (selectedValue === 'targets') {
                    // Set map type to targets and show submenu
                    currentMapType = 'targets';
                    
                    // Update toggle switch appearance
                    toggleSwitch.setAttribute('data-active', selectedValue);
                    
                    // Hide climate targets submenu if it's open
                    hideClimateTargetsSubmenu();
                    hideRegulationsSubmenu();
                    
                    showTargetsSubmenu();
                    // Update the map to show Electricity data immediately
                    updateMap();
                } else if (selectedValue === 'climateTargets') {
                    // Set map type to climate targets and show submenu
                    currentMapType = 'climateTargets';
                    
                    // Update toggle switch appearance
                    toggleSwitch.setAttribute('data-active', selectedValue);
                    
                    // Hide RE targets submenu if it's open
                    hideTargetsSubmenu();
                    hideRegulationsSubmenu();
                    
                    showClimateTargetsSubmenu();
                    // Update the map to show climate targets data immediately
                    updateMap();
                } else if (selectedValue === 'regulations') {
                    currentMapType = 'regulations';

                    toggleSwitch.setAttribute('data-active', selectedValue);
                    hideTargetsSubmenu();
                    hideClimateTargetsSubmenu();
                    showRegulationsSubmenu();
                    updateMap();
                } else {
                    // Hide both submenus if they're open
                    hideTargetsSubmenu();
                    hideClimateTargetsSubmenu();
                    hideRegulationsSubmenu();
                    
                    // Update toggle switch appearance
                    toggleSwitch.setAttribute('data-active', selectedValue);
                    
                    // Update hidden radio buttons for compatibility
                    const radioButton = document.querySelector(`input[name="mapType"][value="${selectedValue}"]`) as HTMLInputElement;
                    if (radioButton) {
                        radioButton.checked = true;
                        currentMapType = selectedValue;
                        updateMap();
                    }
                }
            });
        });
    }

    document.getElementById('regulationsSubmenuClose')?.addEventListener('click', hideRegulationsSubmenu);
    document.getElementById('showBuildCodesRegulations')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        currentMapType = 'regulations';
        toggleSwitch?.setAttribute('data-active', 'regulations');
        setRegulationsSection('buildCodes');
        updateMap(true);
    });
    document.getElementById('showBuildableLandRegulations')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        currentMapType = 'regulations';
        toggleSwitch?.setAttribute('data-active', 'regulations');
        setRegulationsSection('buildableLand');
        updateMap(true);
    });

    // Initial map update to load the correct data based on currentMapType
    updateMap();

    function formatYearGroupLabel(group: '2020' | '2030' | '2050' | 'latest'): string {
        return group === 'latest' ? 'Latest target year' : `Target year ${group}`;
    }

    function getMapExportCaption() {
        const yearLabel = formatYearGroupLabel(currentTargetYearGroup);
        const climateYearLabel = formatYearGroupLabel(currentClimateTargetYearGroup);

        if (currentMapType === 'regulations') {
            if (currentRegulationsSection === 'buildableLand') {
                const isCountry = !!document.querySelector('#buildable-land-view .bl-country-svg');
                return {
                    title: isCountry ? 'Buildable Land — Country Map' : 'Buildable Land — World Map',
                    subtitle: 'Regulations · OSM-based buildable area from regulation rules',
                    legend: 'Map colors show buildable land availability',
                };
            }
            return {
                title: 'Build Codes — Constraint Pressure',
                subtitle: 'Regulations · Surveyed NUTS regions',
                legend: 'Color scale: regulatory constraint pressure by region',
            };
        }

        switch (currentMapType) {
            case 'policies':
                return {
                    title: 'Renewable Energy Support Policies',
                    subtitle: 'World map by country',
                    legend: 'Color scale: number of RE support policies per country (darker = more)',
                };
            case 'ev':
                return {
                    title: 'EV Support Policies',
                    subtitle: 'World map by country',
                    legend: 'Color scale: number of EV support policies per country (darker = more)',
                };
            case 'targets':
                return {
                    title: `Renewable Energy Targets — ${currentTargetType}`,
                    subtitle: `World map · ${yearLabel}`,
                    legend: 'Color scale: renewable target (%) by country',
                };
            case 'climateTargets':
                return {
                    title: 'Climate Emission Targets',
                    subtitle: `EU countries · ${climateYearLabel}`,
                    legend: 'Color scale: emission reduction target (% change vs 1990 baseline)',
                };
            default:
                return { title: 'Climate Policy Atlas Map', subtitle: 'World map' };
        }
    }

    function getDashboardExportCaption(countryName: string) {
        const yearLabel = formatYearGroupLabel(currentTargetYearGroup);
        const climateYearLabel = formatYearGroupLabel(currentClimateTargetYearGroup);
        const leftPanel = document.getElementById('dashboard-pie');
        const rightPanel = document.getElementById('dashboard-timeseries');
        const leftHasChart = !!(
            leftPanel &&
            leftPanel.style.display !== 'none' &&
            leftPanel.querySelector('svg') &&
            leftPanel.querySelector('svg')!.getBoundingClientRect().width > 80
        );
        const rightHasChart = !!(
            rightPanel &&
            rightPanel.style.display !== 'none' &&
            rightPanel.querySelector('svg') &&
            rightPanel.querySelector('svg')!.getBoundingClientRect().width > 80
        );

        switch (currentMapType) {
            case 'ev':
                return {
                    title: `${countryName} — EV Support Policy Timeline`,
                    subtitle: 'Country dashboard',
                    legend: 'Bars show when each EV support policy type was introduced by year',
                };
            case 'targets':
                return {
                    title: `${countryName} — Renewable Energy Targets`,
                    subtitle: `${currentTargetType} · ${yearLabel}`,
                    legend: 'Lines show target (%) progression by decision year and target year',
                };
            case 'climateTargets':
                return {
                    title: `${countryName} — Climate Emission Targets`,
                    subtitle: climateYearLabel,
                    legend: 'Emission reduction targets (% change compared to 1990 baseline)',
                };
            default:
                if (leftHasChart && rightHasChart) {
                    return {
                        title: `${countryName} — Country Dashboard`,
                        subtitle: 'RE support policies and renewable energy targets',
                        legend: 'Left: renewable energy targets progression · Right: RE support policy introduction timeline by year',
                    };
                }
                if (rightHasChart) {
                    return {
                        title: `${countryName} — RE Support Policy Timeline`,
                        subtitle: 'Country dashboard',
                        legend: 'Bars show when each RE support policy type was introduced by year',
                    };
                }
                if (leftHasChart) {
                    return {
                        title: `${countryName} — Renewable Energy Targets Progression`,
                        subtitle: 'Country dashboard',
                        legend: 'Lines show target (%) progression by decision year and target year',
                    };
                }
                return {
                    title: `${countryName} — Country Dashboard`,
                    subtitle: 'Country dashboard · RE support policies',
                    legend: 'Dashboard charts for the selected country',
                };
        }
    }

    function getMainMapExportSlug(): string {
        if (currentMapType === 'regulations') {
            if (currentRegulationsSection === 'buildableLand') {
                return document.querySelector('#buildable-land-view .bl-country-svg')
                    ? 'buildable-land-country'
                    : 'buildable-land-world';
            }
            return 'build-codes-regulations';
        }
        switch (currentMapType) {
            case 'policies': return 'world-map-re-support';
            case 'ev': return 'world-map-ev-support';
            case 'targets': return `world-map-re-targets-${currentTargetType.toLowerCase().replace(/\s+/g, '-')}`;
            case 'climateTargets': return 'world-map-climate-targets';
            default: return 'world-map';
        }
    }

    function getMapExportFilenameSlug(): string {
        return getMainMapExportSlug();
    }

    function getMapExportSvgs(): SVGSVGElement[] | null {
        if (currentMapType === 'regulations') {
            if (currentRegulationsSection === 'buildableLand') {
                const countrySvg = document.querySelector('#buildable-land-view .bl-country-svg') as SVGSVGElement | null;
                if (countrySvg) return [countrySvg];
                const worldSvg = document.querySelector('#buildable-land-view svg.bl-world') as SVGSVGElement | null;
                return worldSvg ? [worldSvg] : null;
            }
            const buildCodesSvg = document.querySelector('#build-codes-view svg') as SVGSVGElement | null;
            return buildCodesSvg ? [buildCodesSvg] : null;
        }

        const worldMap = document.getElementById('world-map') as SVGSVGElement | null;
        return worldMap ? [worldMap] : null;
    }

    async function downloadCountryData(countryCode3: string, countryName: string): Promise<void> {
        const wb = XLSX.utils.book_new();

        try {
            const infoDataUrl = `${baseUrl}data/info_data.xlsx`;
            const infoBuffer = await fetch(infoDataUrl).then(r => r.arrayBuffer());
            const infoWb = XLSX.read(infoBuffer);
            if (infoWb.SheetNames.length > 0) {
                XLSX.utils.book_append_sheet(wb, infoWb.Sheets[infoWb.SheetNames[0]], infoWb.SheetNames[0]);
            }
        } catch (e) {
            console.error('Failed to load info sheet', e);
        }

        const rowsPolicies = policyCsv.filter((row: any) => {
            const cName = normalizePolicyCountryName(row[countryColumnName]);
            if (!cName) return false;
            const code3 = countryNameMap[cName] || null;
            return code3 === countryCode3;
        });
        const headersPolicies = (policyCsv.columns && policyCsv.columns.length > 0)
            ? policyCsv.columns
            : Array.from(new Set(rowsPolicies.flatMap((r: any) => Object.keys(r))));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsPolicies, { header: headersPolicies }), 'Policies');

        const rowsTargets = targetsCsv.filter((row: any) => {
            const code = row[tCountryCodeCol] || row[Object.keys(row)[0]];
            return code === countryCode3;
        });
        const headersTargets = (targetsCsv.columns && targetsCsv.columns.length > 0)
            ? targetsCsv.columns
            : Array.from(new Set(rowsTargets.flatMap((r: any) => Object.keys(r))));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsTargets, { header: headersTargets }), 'Targets');

        const rowsClimate = climateTargetsCsv.filter((row: any) => {
            const code = row[ctCountryCodeCol] || row[Object.keys(row)[0]];
            return code === countryCode3;
        });
        const headersClimate = (climateTargetsCsv.columns && climateTargetsCsv.columns.length > 0)
            ? climateTargetsCsv.columns
            : Array.from(new Set(rowsClimate.flatMap((r: any) => Object.keys(r))));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsClimate, { header: headersClimate }), 'ClimateTargets');

        const rowsEv = evCsv.filter((row: any) => {
            const code = String(row[evCountryCodeCol] || '').trim().toUpperCase();
            return code === countryCode3;
        });
        const headersEv = (evCsv.columns && evCsv.columns.length > 0)
            ? evCsv.columns
            : Array.from(new Set(rowsEv.flatMap((r: any) => Object.keys(r))));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsEv, { header: headersEv }), 'EV_Support');

        const safeName = countryName.replace(/[^\w\-]+/g, '_');
        XLSX.writeFile(wb, `${safeName}_data.xlsx`, { compression: true });
    }

    async function downloadFullDataset(): Promise<void> {
        const sources = allData?.rawSources;
        if (!sources) {
            throw new Error('Dataset is not loaded yet.');
        }

        const wb = XLSX.utils.book_new();

        try {
            const infoDataUrl = `${baseUrl}data/info_data.xlsx`;
            const infoBuffer = await fetch(infoDataUrl).then(r => r.arrayBuffer());
            const infoWb = XLSX.read(infoBuffer);
            if (infoWb.SheetNames.length > 0) {
                XLSX.utils.book_append_sheet(wb, infoWb.Sheets[infoWb.SheetNames[0]], infoWb.SheetNames[0]);
            }
        } catch (e) {
            console.error('Failed to load info sheet', e);
        }

        const addSheet = (name: string, rows: any[]) => {
            const headers = (rows && (rows as any).columns && (rows as any).columns.length > 0)
                ? (rows as any).columns
                : Array.from(new Set(rows.flatMap((r: any) => Object.keys(r))));
            const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
            XLSX.utils.book_append_sheet(wb, ws, name);
        };

        addSheet('Policies', sources.policyCsv as any);
        addSheet('Targets', sources.targetsCsv as any);
        addSheet('ClimateTargets', sources.climateTargetsCsv as any);
        addSheet('EV_Support', sources.evCsv as any);

        XLSX.writeFile(wb, 'Climate_Policy_Atlas_1.0.xlsx', { compression: true });
    }

    const mapContainer = document.getElementById('world-map-container');
    if (mapContainer) {
        registerGraphDownloadMenu({
            container: mapContainer,
            title: 'Download map or data',
            getActiveSvgs: getMapExportSvgs,
            getFilenameSlug: getMapExportFilenameSlug,
            getExportCaption: getMapExportCaption,
            onDownloadDataset: downloadFullDataset,
        });
    }
    
    // Hide loading indicator after initial map is loaded
    hideLoadingIndicator();

    // Match the targets/climate submenu widths to the toggle's actual rendered
    // width so the dropdowns line up. Width clamping for the toggle itself is
    // done in CSS via `width: clamp(360px, 86vw, 760px)`.
    function syncSubmenuWidths() {
        const toggle = document.getElementById('mapTypeToggle') as HTMLElement | null;
        const submenu = document.getElementById('targetsSubmenu') as HTMLElement | null;
        const climateSubmenu = document.getElementById('climateTargetsSubmenu') as HTMLElement | null;
        if (!toggle) return;
        const toggleWidth = toggle.getBoundingClientRect().width;
        const submenuWidth = Math.max(400, Math.round(toggleWidth));
        if (submenu) submenu.style.width = `${submenuWidth}px`;
        if (climateSubmenu) climateSubmenu.style.width = `${submenuWidth}px`;
    }
    requestAnimationFrame(syncSubmenuWidths);
    window.addEventListener('resize', syncSubmenuWidths);

}).catch(error => {
    console.error('Error loading data:', error);
    // Hide loading indicator even if there's an error
    hideLoadingIndicator();
});
