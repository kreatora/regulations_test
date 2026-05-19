import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import './ontologyvisualization.css';

interface OntologyDataNode {
  name: string; // Changed from label to name to match json
  id?: string; // id might be generated, so optional initially
  definition?: string; // definition might not exist on all original nodes
  children?: OntologyDataNode[];
}

interface OntologyNode extends OntologyDataNode {
  id: string;
  label: string; // Keep label for display consistency if needed, or map from name
  definition: string;
  children?: OntologyNode[];
  x: number;
  y: number;
  level: number;
  parentId?: string | null;
  isRoot?: boolean;
  // allChildren?: string[]; // This was in placeholder, assess if needed
  visible: boolean;
  hiddenByCollapse?: boolean; // To track if hidden due to parent collapse
  collapsed?: boolean; // To track if the node itself is collapsed
}

interface Connection {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  level: number;
}

const CARD_WIDTH = 220;
const CARD_HEIGHT = 130;
const CHILD_X_SPACING = 300;
const CHILD_Y_SPACING = 180;
const TRANSITION_MS = 900;

const OntologyVisualization: React.FC = () => {
  const [viewMode, setViewMode] = useState<'tree' | 'tableInteractive'>('tree');
  const [tableQuery, setTableQuery] = useState('');
  const [pdfAvailable, setPdfAvailable] = useState<boolean | null>(null);
  const [interactiveExpandedIds, setInteractiveExpandedIds] = useState<Set<string>>(new Set());
  const [interactiveAnimateIds, setInteractiveAnimateIds] = useState<Set<string>>(new Set());
  const [interactiveExpandedDefinitionIds, setInteractiveExpandedDefinitionIds] = useState<Set<string>>(new Set());
  const [interactiveDefinitionOverflowIds, setInteractiveDefinitionOverflowIds] = useState<Set<string>>(new Set());

  const [nodes, setNodes] = useState<OntologyNode[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [scale, setScale] = useState(0.6);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [startDragCoords, setStartDragCoords] = useState({ x: 0, y: 0 });
  const [startOffset, setStartOffset] = useState({ x: 0, y: 0 });
  const [currentlyZoomedNodeId, setCurrentlyZoomedNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<OntologyNode | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const visualizationContainerRef = useRef<HTMLDivElement>(null);
  const nodeCounterRef = useRef(0);
  const transitionTokenRef = useRef(0);
  const transitionTimeoutRef = useRef<number | null>(null);

  const updateTransform = useCallback(() => {
    if (visualizationContainerRef.current) {
      visualizationContainerRef.current.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`;
    }
    // const zoomLevelDisplay = document.getElementById('zoom-level-display'); // In original component
    // if (zoomLevelDisplay) {
    //   zoomLevelDisplay.textContent = `${Math.round(scale * 100)}%`;
    // }
  }, [offsetX, offsetY, scale]);

  useEffect(() => {
    updateTransform();
  }, [updateTransform]);

  const pdfUrl = useMemo(() => `${import.meta.env.BASE_URL}ontology_interactive.pdf`, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(pdfUrl, { method: 'HEAD' });
        if (!cancelled) setPdfAvailable(res.ok);
      } catch {
        if (!cancelled) setPdfAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  const handleDownloadPdf = useCallback(async () => {
    // If we already know it's missing, avoid a noisy 404 navigation.
    if (pdfAvailable === false) {
      window.alert('PDF not available yet. Drop the file in /public as ontology.pdf and it will enable automatically.');
      return;
    }
    try {
      const res = await fetch(pdfUrl, { method: 'HEAD' });
      if (!res.ok) throw new Error('PDF missing');
      setPdfAvailable(true);

      const a = document.createElement('a');
      a.href = pdfUrl;
      a.download = 'ontology_interactive.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setPdfAvailable(false);
      window.alert('PDF not available yet. Drop the file in /public as ontology.pdf and it will enable automatically.');
    }
  }, [pdfAvailable, pdfUrl]);

  const centerOnNodes = useCallback((targetNodes: OntologyNode[], newScale?: number) => {
    if (!targetNodes || targetNodes.length === 0 || !viewportRef.current) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    targetNodes.forEach(node => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + CARD_WIDTH);
      maxY = Math.max(maxY, node.y + CARD_HEIGHT);
    });

    const padding = targetNodes.length > 1 ? 50 : 20; // Further reduced padding
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const viewportWidth = viewportRef.current.offsetWidth;
    const viewportHeight = viewportRef.current.offsetHeight;

    const areaWidth = maxX - minX;
    const areaHeight = maxY - minY;
    const areaCenterX = minX + (areaWidth / 2);
    const areaCenterY = minY + (areaHeight / 2);

    const calculatedScale = newScale ?? Math.min(Math.min(viewportWidth / areaWidth, viewportHeight / areaHeight) * 0.95, 1.5); // Slightly increased multiplier
    
    // Prepare a smooth transition. Multiple calls to centerOnNodes can overlap (e.g. visibility updates + centering),
    // so we use a token to ensure old cleanups don't cancel the current animation mid-flight.
    const container = visualizationContainerRef.current;
    const myToken = ++transitionTokenRef.current;
    if (container) {
      container.style.transition = `transform ${TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;

      if (transitionTimeoutRef.current != null) {
        window.clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = null;
      }

      const cleanup = () => {
        if (transitionTokenRef.current !== myToken) return;
        if (visualizationContainerRef.current) {
          visualizationContainerRef.current.style.transition = 'none';
        }
      };

      // Prefer transitionend (more accurate than timers), but keep a timer as a fallback.
      const onEnd = (ev: TransitionEvent) => {
        if (ev.propertyName !== 'transform') return;
        cleanup();
      };
      container.addEventListener('transitionend', onEnd, { once: true });
      transitionTimeoutRef.current = window.setTimeout(() => {
        cleanup();
      }, TRANSITION_MS + 50);
    }

    setScale(calculatedScale);
    setOffsetX((viewportWidth / 2) - (areaCenterX * calculatedScale));
    setOffsetY((viewportHeight / 2) - (areaCenterY * calculatedScale));
  }, [setScale, setOffsetX, setOffsetY]);


  const drawConnectionsRecursive = useCallback((processedNodes: OntologyNode[]) => {
    const newConnections: Connection[] = [];
    processedNodes.forEach(node => {
      if (node.parentId && node.visible) {
        const parentNode = processedNodes.find(p => p.id === node.parentId);
        if (parentNode && parentNode.visible) {
          newConnections.push({
            id: `conn-${parentNode.id}-${node.id}`,
            x1: parentNode.x + CARD_WIDTH / 2,
            y1: parentNode.y + CARD_HEIGHT,
            x2: node.x + CARD_WIDTH / 2,
            y2: node.y,
            level: Math.min(parentNode.level, 5),
          });
        }
      }
    });
    setConnections(newConnections);
  }, []);


  const processNodeRecursive = useCallback((dataNode: OntologyDataNode, x: number, y: number, level: number, parentId: string | null, isRoot = false): OntologyNode[] => {
    const nodeId = `node_${nodeCounterRef.current++}`;
    const newNode: OntologyNode = {
      ...dataNode,
      id: nodeId,
      label: dataNode.name, // Assuming name is the primary display string
      definition: dataNode.definition || dataNode.name, // Fallback for definition
      x,
      y,
      level,
      parentId,
      isRoot,
      visible: isRoot, // Only the root node is visible initially
      collapsed: true, // All nodes start collapsed
      children: [], // Will be populated by recursive calls
    };

    let allProcessedNodes = [newNode];

    if (dataNode.children && dataNode.children.length > 0) {
      const totalChildrenWidth = dataNode.children.length * CHILD_X_SPACING;
      let startX = x + (CARD_WIDTH / 2) - (totalChildrenWidth / 2);
      
      dataNode.children.forEach((child) => {
        const childX = startX;
        const childY = y + CHILD_Y_SPACING;
        const processedChildren = processNodeRecursive(child, childX, childY, level + 1, nodeId);
        newNode.children?.push(...processedChildren.filter(cn => cn.parentId === nodeId)); // Add direct children
        allProcessedNodes = allProcessedNodes.concat(processedChildren);
        startX += CHILD_X_SPACING;
      });
    }
    return allProcessedNodes;
  }, []);
  
  useEffect(() => {
    const dataUrl = `${import.meta.env.BASE_URL}ontology_tree.json`;
    console.log(`Fetching data from: ${dataUrl}`); // Log the actual URL
    fetch(dataUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then((data: OntologyDataNode | OntologyDataNode[]) => {
        console.log("Fetched ontology data:", data); // DEBUG
        nodeCounterRef.current = 0; // Reset counter
        const rootDataNode = Array.isArray(data) ? data[0] : data; // Get the first element if it's an array
        if (!rootDataNode) {
          console.error("Ontology data is empty or invalid.");
          return;
        }
        const initialX = 50; // Fixed small coordinate for debugging
        const initialY = 50; // Fixed small coordinate for debugging
        const processedNodes = processNodeRecursive(rootDataNode, initialX, initialY, 0, null, true);
        console.log("Processed nodes (full array):", processedNodes); // DEBUG: Log the entire processedNodes array
        console.log("Processed nodes length:", processedNodes.length); // DEBUG: Log the length

        if (visualizationContainerRef.current) {
            console.log("Visualization container width:", visualizationContainerRef.current.offsetWidth);
            console.log("Visualization container height:", visualizationContainerRef.current.offsetHeight);
        }

        // Log coordinates of first few nodes if they exist
        processedNodes.slice(0, 5).forEach(node => {
            console.log(`Node ${node.id}: x=${node.x}, y=${node.y}, visible=${node.visible}, collapsed=${node.collapsed}`);
        });

        setNodes(processedNodes);
        // Temporarily disable initial centering for debugging
        if (processedNodes.length > 0) {
           setTimeout(() => {
            console.log("Initial centering on visible nodes"); // DEBUG
            const initiallyVisibleNodes = processedNodes.filter(n => n.visible);
            centerOnNodes(initiallyVisibleNodes);
           }, 100); 
        }
      })
      .catch(error => console.error('Error loading ontology data:', error));
  }, [processNodeRecursive, centerOnNodes]);

  useEffect(() => {
    drawConnectionsRecursive(nodes);
  }, [nodes, drawConnectionsRecursive]);


  const getDescendantIds = useCallback((nodeId: string, currentNodes: OntologyNode[]): string[] => {
    const descendants: string[] = [];
    const stack: string[] = [nodeId];
    const directChildrenMap = new Map<string, string[]>();

    currentNodes.forEach(n => {
        if (n.parentId) {
            if (!directChildrenMap.has(n.parentId)) {
                directChildrenMap.set(n.parentId, []);
            }
            directChildrenMap.get(n.parentId)!.push(n.id);
        }
    });

    while (stack.length > 0) {
        const currentId = stack.pop()!;
        const childrenIds = directChildrenMap.get(currentId) || [];
        for (const childId of childrenIds) {
            descendants.push(childId);
            stack.push(childId);
        }
    }
    return descendants;
}, []);


  const handleNodeClick = useCallback((clickedNodeId: string) => {
    setNodes(prevNodes => {
      const clickedNode = prevNodes.find(n => n.id === clickedNodeId);
      if (!clickedNode) return prevNodes;

      // Set the selected node for the side panel display
      setSelectedNode(clickedNode);

      let newNodes = [...prevNodes];
      const isEndNode = !clickedNode.children || clickedNode.children.length === 0;

      if (isEndNode) {
        if (currentlyZoomedNodeId === clickedNodeId) {
          // Zoom out to parent and its visible siblings
          setCurrentlyZoomedNodeId(null);
          const parentNode = newNodes.find(n => n.id === clickedNode.parentId);
          if (parentNode) {
            const visibleSiblings = newNodes.filter(n => n.parentId === parentNode.id && n.visible);
            centerOnNodes([parentNode, ...visibleSiblings]);
          } else { // If no parent, might be root, or orphan, center on itself
            centerOnNodes([clickedNode]);
          }
        } else {
          // Zoom in to this end node
          setCurrentlyZoomedNodeId(clickedNodeId);
          if (viewportRef.current) {
            const viewportRect = viewportRef.current.getBoundingClientRect();
            const targetWidth = viewportRect.width * 0.10; // Further reduced for less zoom
            const newScale = Math.min(targetWidth / CARD_WIDTH, 0.9); // Further reduced max scale
            centerOnNodes([clickedNode], newScale);
          }
        }
        return newNodes; // No visibility change for end node clicks directly
      }

      // Clicked a non-end node (collapsible node)
      setCurrentlyZoomedNodeId(null); // Reset any end-node zoom

      const newCollapsedState = !clickedNode.collapsed;

      // If expanding this node, first collapse its siblings
      if (!newCollapsedState) { // Only when expanding (newCollapsedState is false)
        const siblings = newNodes.filter(
          n => n.parentId === clickedNode.parentId && n.id !== clickedNodeId && !n.collapsed
        );

        siblings.forEach(siblingToCollapse => {
          const descendantIdsOfSibling = getDescendantIds(siblingToCollapse.id, newNodes);
          newNodes = newNodes.map(n => {
            if (n.id === siblingToCollapse.id) {
              return { ...n, collapsed: true, visible: true }; // Sibling itself remains visible but collapsed
            }
            if (descendantIdsOfSibling.includes(n.id)) {
              return { ...n, visible: false, hiddenByCollapse: true, collapsed: true };
            }
            return n;
          });
        });
      }
      
      newNodes = newNodes.map(n => {
        if (n.id === clickedNodeId) {
          return { ...n, collapsed: newCollapsedState };
        }
        // If collapsing the clicked node, hide its direct children
        if (n.parentId === clickedNodeId && newCollapsedState) {
           return { ...n, visible: false, hiddenByCollapse: true };
        }
        // If expanding the clicked node, show its direct children
        if (n.parentId === clickedNodeId && !newCollapsedState) {
            return { ...n, visible: true, hiddenByCollapse: false };
        }
        return n;
      });
      
      // Handle descendants for the clicked node
      if (newCollapsedState) { // If we just collapsed the clickedNode
          const allDescendantIdsToHide = getDescendantIds(clickedNodeId, newNodes);
          newNodes = newNodes.map(n => {
              if (allDescendantIdsToHide.includes(n.id)) {
                  // Ensure descendants are also marked as collapsed and hiddenByCollapse
                  return { ...n, visible: false, hiddenByCollapse: true, collapsed: true }; 
              }
              return n;
          });
      } else { // If we just expanded the clickedNode
           newNodes = newNodes.map(n => {
              if (n.parentId === clickedNodeId) {
                  // Direct children are made visible and their hiddenByCollapse is false
                  // Their own collapsed state remains as is (they might have been individually collapsed before parent)
                  return { ...n, visible: true, hiddenByCollapse: false };
              }
              return n;
          });
      }
      
      // Center view
      const childrenToConsiderForCentering = newNodes.filter(n => n.parentId === clickedNodeId && n.visible);
      if (newCollapsedState) { // If collapsed, center only on the clicked node
        centerOnNodes([clickedNode]);
      } else { // If expanded, center on node and its visible children
        centerOnNodes([clickedNode, ...childrenToConsiderForCentering]);
      }

      return newNodes;
    });
  }, [currentlyZoomedNodeId, centerOnNodes, getDescendantIds]);


  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== viewportRef.current && e.target !== visualizationContainerRef.current && !(e.target as HTMLElement).classList.contains('visualization-container')) return;
    setIsDragging(true);
    setStartDragCoords({ x: e.clientX, y: e.clientY });
    setStartOffset({ x: offsetX, y: offsetY });
    if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing';
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startDragCoords.x;
    const dy = e.clientY - startDragCoords.y;
    setOffsetX(startOffset.x + dx);
    setOffsetY(startOffset.y + dy);
  }, [isDragging, startDragCoords, startOffset]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    if (viewportRef.current) viewportRef.current.style.cursor = 'grab';
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleWheelZoom = useCallback((e: WheelEvent) => {
    if (!viewportRef.current) return;
    e.preventDefault();

    const rect = viewportRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const beforeZoomX = (mouseX - offsetX) / scale;
    const beforeZoomY = (mouseY - offsetY) / scale;

    const zoomFactor = 1.05;
    let newScale;
    if (e.deltaY < 0) { // Scroll up - zoom in
      newScale = Math.min(scale * zoomFactor, 1.5);
    } else { // Scroll down - zoom out
      newScale = Math.max(scale / zoomFactor, 0.3);
    }

    const newOffsetX = mouseX - (beforeZoomX * newScale);
    const newOffsetY = mouseY - (beforeZoomY * newScale);
    
    setScale(newScale);
    setOffsetX(newOffsetX);
    setOffsetY(newOffsetY);

  }, [offsetX, offsetY, scale]);

  useEffect(() => {
    // Only attach wheel-zoom when in Tree view.
    // Otherwise the preventDefault() blocks scrolling inside table views.
    if (viewMode !== 'tree') return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.addEventListener('wheel', handleWheelZoom, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', handleWheelZoom);
    };
  }, [handleWheelZoom, viewMode]);
  
  const handleResetZoom = useCallback(() => {
    setCurrentlyZoomedNodeId(null);
    setSelectedNode(null);

    setNodes(prevNodes => {
      const rootNode = prevNodes.find(n => n.isRoot);
      if (!rootNode) return prevNodes;

      // Return to the initial state: only root visible; everything collapsed.
      const resetNodes = prevNodes.map(n => ({
        ...n,
        visible: !!n.isRoot,
        collapsed: true,
        hiddenByCollapse: false,
      }));

      // Re-center after state update flushes.
      setTimeout(() => centerOnNodes([rootNode]), 0);
      return resetNodes;
    });
  }, [centerOnNodes]);

  // Returning to Tree view should always reset to the starting point (clean slate).
  const prevViewModeRef = useRef(viewMode);
  useEffect(() => {
    const prev = prevViewModeRef.current;
    if (viewMode === 'tree' && prev !== 'tree') {
      handleResetZoom();
    }
    prevViewModeRef.current = viewMode;
  }, [viewMode, handleResetZoom]);

  // Detect overlapping cards in Tree view to reduce visual clutter.
  const overlappingTreeNodeIds = useMemo(() => {
    if (viewMode !== 'tree') return new Set<string>();
    const visible = nodes.filter(n => n.visible);
    const overlaps = new Set<string>();
    const w = CARD_WIDTH;
    const h = CARD_HEIGHT; // approximate; cards can be taller, but this works well enough visually

    for (let i = 0; i < visible.length; i++) {
      const a = visible[i];
      const ax1 = a.x, ay1 = a.y, ax2 = a.x + w, ay2 = a.y + h;
      for (let j = i + 1; j < visible.length; j++) {
        const b = visible[j];
        const bx1 = b.x, by1 = b.y, bx2 = b.x + w, by2 = b.y + h;
        const intersects = ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
        if (intersects) {
          overlaps.add(a.id);
          overlaps.add(b.id);
        }
      }
    }
    return overlaps;
  }, [nodes, viewMode]);

  type InteractiveRow = {
    node: OntologyNode;
    parentName: string;
    path: string;
    depth: number;
    hasChildren: boolean;
  };

  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  const childrenByParentId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const n of nodes) {
      if (!n.parentId) continue;
      const key = n.parentId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n.id);
    }
    // Stable ordering for interactive table
    for (const [pid, ids] of map.entries()) {
      ids.sort((a, b) => (nodeById.get(a)?.name ?? '').localeCompare(nodeById.get(b)?.name ?? ''));
      map.set(pid, ids);
    }
    return map;
  }, [nodes, nodeById]);

  // Initialize interactive expanded state to show the root(s) by default.
  useEffect(() => {
    if (!nodes.length) return;
    setInteractiveExpandedIds(prev => {
      if (prev.size > 0) return prev;
      const next = new Set<string>();
      for (const n of nodes) {
        if (n.isRoot) next.add(n.id);
      }
      return next;
    });
  }, [nodes]);

  const toggleInteractiveExpanded = useCallback((id: string) => {
    setInteractiveExpandedIds(prev => {
      const next = new Set(prev);
      const wasExpanded = next.has(id);
      if (wasExpanded) next.delete(id);
      else next.add(id);

      // Subtle "content slides in" effect when expanding: animate the direct children rows.
      if (!wasExpanded) {
        const children = childrenByParentId.get(id) ?? [];
        if (children.length) {
          setInteractiveAnimateIds(new Set(children));
          window.setTimeout(() => setInteractiveAnimateIds(new Set()), 180);
        }
      }
      return next;
    });
  }, [childrenByParentId]);

  const toggleInteractiveDefinition = useCallback((id: string) => {
    setInteractiveExpandedDefinitionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const interactiveDefinitionElByIdRef = useRef<Map<string, HTMLDivElement>>(new Map());

  const setAllInteractiveExpanded = useCallback((expanded: boolean) => {
    if (!expanded) {
      setInteractiveExpandedIds(new Set(nodes.filter(n => n.isRoot).map(n => n.id)));
      return;
    }
    setInteractiveExpandedIds(new Set(nodes.map(n => n.id)));
  }, [nodes]);

  const interactiveVisibleIdSet = useMemo(() => {
    const q = tableQuery.trim().toLowerCase();
    if (!q) return null;
    const matches = new Set<string>();
    for (const n of nodes) {
      const name = n.name?.toLowerCase() ?? '';
      const def = n.definition?.toLowerCase() ?? '';
      if (name.includes(q) || def.includes(q)) matches.add(n.id);
    }
    // Include ancestors for context
    const include = new Set<string>();
    for (const id of matches) {
      let cur = nodeById.get(id);
      while (cur) {
        if (include.has(cur.id)) break;
        include.add(cur.id);
        cur = cur.parentId ? nodeById.get(cur.parentId) : undefined;
      }
    }
    return include;
  }, [nodes, nodeById, tableQuery]);

  const interactiveRows = useMemo<InteractiveRow[]>(() => {
    if (!nodes.length) return [];

    const roots = nodes
      .filter(n => n.isRoot || !n.parentId)
      .sort((a, b) => a.name.localeCompare(b.name));

    const rows: InteractiveRow[] = [];
    const stack: Array<{ id: string; depth: number }> = roots.map(r => ({ id: r.id, depth: 0 })).reverse();

    while (stack.length) {
      const { id, depth } = stack.pop()!;
      const node = nodeById.get(id);
      if (!node) continue;

      if (interactiveVisibleIdSet && !interactiveVisibleIdSet.has(id)) {
        // Skip completely if not in filtered set
        continue;
      }

      const parentName = node.parentId ? (nodeById.get(node.parentId)?.name ?? '—') : '—';
      const hasChildren = (childrenByParentId.get(node.id)?.length ?? 0) > 0;

      // Compute a path string for display (root › ... › node).
      const pathParts: string[] = [];
      let cur: OntologyNode | undefined = node;
      const seen = new Set<string>();
      while (cur) {
        if (seen.has(cur.id)) break;
        seen.add(cur.id);
        pathParts.push(cur.name);
        cur = cur.parentId ? nodeById.get(cur.parentId) : undefined;
      }
      const path = pathParts.reverse().join(' › ');

      rows.push({ node, parentName, path, depth, hasChildren });

      const shouldExpand =
        hasChildren &&
        (interactiveVisibleIdSet
          ? true // when searching, always expand through context
          : interactiveExpandedIds.has(node.id));

      if (shouldExpand) {
        const children = childrenByParentId.get(node.id) ?? [];
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push({ id: children[i], depth: depth + 1 });
        }
      }
    }

    return rows;
  }, [nodes, nodeById, childrenByParentId, interactiveExpandedIds, interactiveVisibleIdSet]);

  useEffect(() => {
    if (viewMode !== 'tableInteractive') return;

    // Measure whether the definition is visually clamped (i.e. content overflows the 2-line clamp).
    // This avoids showing "More" for short strings that just happen to exceed a char threshold,
    // and correctly shows "More" for shorter strings that wrap into more than 2 lines on narrow screens.
    const raf = window.requestAnimationFrame(() => {
      const next = new Set<string>();
      for (const r of interactiveRows) {
        const el = interactiveDefinitionElByIdRef.current.get(r.node.id);
        if (!el) continue;
        // scrollHeight > clientHeight indicates there is hidden/clamped content.
        if (el.scrollHeight > el.clientHeight + 1) next.add(r.node.id);
      }
      setInteractiveDefinitionOverflowIds(next);
    });

    return () => window.cancelAnimationFrame(raf);
  }, [interactiveRows, viewMode]);


  return (
    <div
      className="viewport"
      ref={viewportRef}
      onMouseDown={handleMouseDown}
    >
      <div className="ontology-toolbar" role="toolbar" aria-label="Ontology controls">
        <div className="view-toggle" role="tablist" aria-label="Switch view">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'tree'}
            className={`view-toggle-button ${viewMode === 'tree' ? 'active' : ''}`}
            onClick={() => setViewMode('tree')}
          >
            Tree view
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'tableInteractive'}
            className={`view-toggle-button ${viewMode === 'tableInteractive' ? 'active' : ''}`}
            onClick={() => setViewMode('tableInteractive')}
          >
            Table view
          </button>
        </div>

        <div className="toolbar-right">
          <div className="pdf-cta">
            <span className="pdf-cta-text">Download ontology as PDF</span>
            <button
              type="button"
              className={`pdf-button ${pdfAvailable === false ? 'disabled' : ''}`}
              onClick={handleDownloadPdf}
              disabled={pdfAvailable === false}
              title={pdfAvailable === false ? 'PDF not uploaded yet' : 'Download ontology as PDF'}
            >
              PDF
            </button>
          </div>
        </div>
      </div>

      {viewMode === 'tree' ? (
        <>
          <div
            className="visualization-container"
            ref={visualizationContainerRef}
          >
            {nodes.filter(node => node.visible).map(node => (
              <div
                key={node.id}
                className={`card ${node.isRoot ? 'root-card' : ''} ${node.collapsed ? 'collapsed' : ''} ${selectedNode?.id === node.id ? 'selected' : ''} ${overlappingTreeNodeIds.has(node.id) ? 'overlapping' : ''}`}
                style={{ left: `${node.x}px`, top: `${node.y}px` }}
                onClick={(e) => { e.stopPropagation(); handleNodeClick(node.id);}}
                data-id={node.id} // For potential debugging or direct DOM selection if ever needed
                data-level={node.level}
                data-parent-id={node.parentId}
              >
                <div className="card-name">{node.name}</div>
                {(node.children && node.children.length > 0) && (
                  <div className="expand-icon"></div>
                )}
              </div>
            ))}
            {connections.map(conn => (
              <div
                key={conn.id}
                className={`connection-line connection-line-level-${conn.level}`}
                style={{
                  width: `${Math.sqrt(Math.pow(conn.x2 - conn.x1, 2) + Math.pow(conn.y2 - conn.y1, 2))}px`,
                  left: `${conn.x1}px`,
                  top: `${conn.y1}px`,
                  transform: `rotate(${Math.atan2(conn.y2 - conn.y1, conn.x2 - conn.x1) * 180 / Math.PI}deg)`
                }}
              ></div>
            ))}
          </div>

          <div className="zoom-controls">
            <button className="reset-button" onClick={handleResetZoom}>Reset</button>
          </div>
        </>
      ) : (
        <div className="ontology-table-wrap" role="region" aria-label="Ontology table">
          <div className="ontology-table-controls">
            <div className="ontology-search">
              <label className="ontology-search-label" htmlFor="ontology-search-input">Search</label>
              <input
                id="ontology-search-input"
                className="ontology-search-input"
                value={tableQuery}
                onChange={(e) => setTableQuery(e.target.value)}
                placeholder="Search concepts, definitions…"
              />
            </div>
            <div className="ontology-table-actions">
              <button type="button" className="ontology-mini-button" onClick={() => setAllInteractiveExpanded(true)}>
                Expand all
              </button>
              <button type="button" className="ontology-mini-button" onClick={() => setAllInteractiveExpanded(false)}>
                Collapse all
              </button>
            </div>
            <div className="ontology-table-meta">
              {interactiveRows.length.toLocaleString()} concepts
            </div>
          </div>

          <div className="ontology-table-card">
            <table className="ontology-table ontology-table-interactive">
              <thead>
                <tr>
                  <th>Concept</th>
                  <th>Parent</th>
                  <th>Definition</th>
                </tr>
              </thead>
              <tbody>
                {interactiveRows.map(r => (
                  <tr
                    key={r.node.id}
                    className={[
                      selectedNode?.id === r.node.id ? 'selected' : '',
                      interactiveAnimateIds.has(r.node.id) ? 'just-revealed' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setSelectedNode(r.node)}
                  >
                    <td>
                      <div className="ontology-interactive-cell">
                        {r.depth > 0 ? (
                          <span
                            className="ontology-indent-guides"
                            style={{ width: `${r.depth * 18}px` }}
                            aria-hidden="true"
                          />
                        ) : null}
                        {r.hasChildren ? (
                          <button
                            type="button"
                            className="ontology-disclosure"
                            aria-label={interactiveExpandedIds.has(r.node.id) ? 'Collapse' : 'Expand'}
                            aria-expanded={interactiveExpandedIds.has(r.node.id)}
                            onClick={(e) => { e.stopPropagation(); toggleInteractiveExpanded(r.node.id); }}
                          >
                            {interactiveVisibleIdSet ? '▾' : (interactiveExpandedIds.has(r.node.id) ? '▾' : '▸')}
                          </button>
                        ) : (
                          <span className="ontology-disclosure-spacer" aria-hidden="true"></span>
                        )}
                        <div className="ontology-table-concept">
                          <div className="ontology-table-name">{r.node.name}</div>
                          <div className="ontology-table-path">{r.path}</div>
                        </div>
                      </div>
                    </td>
                    <td className="ontology-table-parent">{r.parentName}</td>
                    <td>
                      <div className="ontology-definition-cell">
                        <div
                          ref={(el) => {
                            const map = interactiveDefinitionElByIdRef.current;
                            if (el) map.set(r.node.id, el);
                            else map.delete(r.node.id);
                          }}
                          className={`ontology-table-definition ${interactiveExpandedDefinitionIds.has(r.node.id) ? 'expanded' : ''}`}
                        >
                          {r.node.definition}
                        </div>
                        {(interactiveExpandedDefinitionIds.has(r.node.id) || interactiveDefinitionOverflowIds.has(r.node.id)) ? (
                          <button
                            type="button"
                            className="ontology-more-button"
                            onClick={(e) => { e.stopPropagation(); toggleInteractiveDefinition(r.node.id); }}
                          >
                            {interactiveExpandedDefinitionIds.has(r.node.id) ? 'Less' : 'More'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {interactiveRows.length === 0 && (
                  <tr>
                  <td colSpan={3} className="ontology-table-empty">
                      No results. Try a different search query.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewMode === 'tree' && selectedNode && (
        <div className="definition-panel">
          <h3 className="panel-title">{selectedNode.name}</h3>
          <p className="panel-definition">{selectedNode.definition}</p>
          <button className="close-panel-button" onClick={() => setSelectedNode(null)}>X</button>
        </div>
      )}

       {/* Banners from original HTML - assuming these are static or handled outside this component if needed */}
       {/* <img src="/left top banner.jpeg" alt="Left Banner" className="left-banner" /> */}
       {/* <img src="/mid title banner.jpeg" alt="Top Banner" className="top-banner" /> */}
    </div>
  );
};

export default OntologyVisualization;