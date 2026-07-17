import { useEffect, useRef, useCallback, useState } from 'react';

interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  filePath?: string;
}

interface GraphEdge {
  source: number;
  target: number;
}

const COLORS = ['#c26647', '#4a9eff', '#50c878', '#e8a838', '#b47cf5', '#ff6b6b'];

export function GraphPanel(): JSX.Element {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  // The draw loop reads the hover target through a ref so that hovering does
  // not re-run the simulation effect — that would restart its stabilization
  // timeout and leave the rAF loop spinning forever.
  const hoveredRef = useRef<number | null>(null);
  hoveredRef.current = hovered;

  const loadGraph = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch conversation list as a proxy for graph data
      const convs = await window.hive.convList();
      const gNodes: GraphNode[] = [];
      const gEdges: GraphEdge[] = [];
      const angleStep = (2 * Math.PI) / Math.max(convs.length, 1);

      convs.forEach((c: { id: string; title: string; projectId?: string }, i: number) => {
        const angle = angleStep * i;
        const radius = 120 + Math.random() * 60;
        gNodes.push({
          id: c.id,
          label: c.title || 'Untitled',
          x: 200 + Math.cos(angle) * radius,
          y: 200 + Math.sin(angle) * radius,
          vx: 0,
          vy: 0,
          color: COLORS[i % COLORS.length],
          filePath: c.projectId,
        });
      });

      // Create edges between conversations that share a project
      const projectMap = new Map<string, number[]>();
      gNodes.forEach((n, i) => {
        if (n.filePath) {
          const arr = projectMap.get(n.filePath) || [];
          arr.push(i);
          projectMap.set(n.filePath, arr);
        }
      });
      for (const indices of projectMap.values()) {
        for (let i = 0; i < indices.length - 1; i++) {
          gEdges.push({ source: indices[i], target: indices[i + 1] });
        }
      }

      nodesRef.current = gNodes;
      edgesRef.current = gEdges;
      setNodes(gNodes);
      setEdges(gEdges);
    } catch (err) {
      console.error('Graph load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadGraph(); }, [loadGraph]);

  // Force-directed simulation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const REPULSION = 5000;
    const ATTRACTION = 0.01;
    const DAMPING = 0.85;

    let running = true;
    const step = (): void => {
      if (!running) return;
      const ns = nodesRef.current;
      const es = edgesRef.current;
      if (ns.length === 0) { animRef.current = requestAnimationFrame(step); return; }

      // Forces
      for (let i = 0; i < ns.length; i++) {
        ns[i].vx = 0;
        ns[i].vy = 0;
      }

      // Repulsion (all pairs)
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const dx = ns[j].x - ns[i].x;
          const dy = ns[j].y - ns[i].y;
          const dist = Math.max(dx * dx + dy * dy, 1);
          const force = REPULSION / dist;
          const fx = (dx / Math.sqrt(dist)) * force;
          const fy = (dy / Math.sqrt(dist)) * force;
          ns[i].vx -= fx;
          ns[i].vy -= fy;
          ns[j].vx += fx;
          ns[j].vy += fy;
        }
      }

      // Attraction (edges)
      for (const e of es) {
        const dx = ns[e.target].x - ns[e.source].x;
        const dy = ns[e.target].y - ns[e.source].y;
        ns[e.source].vx += dx * ATTRACTION;
        ns[e.source].vy += dy * ATTRACTION;
        ns[e.target].vx -= dx * ATTRACTION;
        ns[e.target].vy -= dy * ATTRACTION;
      }

      // Center gravity
      for (const n of ns) {
        n.vx += (W / 2 - n.x) * 0.002;
        n.vy += (H / 2 - n.y) * 0.002;
      }

      // Apply
      for (const n of ns) {
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(20, Math.min(W - 20, n.x));
        n.y = Math.max(20, Math.min(H - 20, n.y));
      }

      // Render
      ctx.clearRect(0, 0, W, H);

      // Edges
      ctx.strokeStyle = 'rgba(150,150,150,0.15)';
      ctx.lineWidth = 1;
      for (const e of es) {
        ctx.beginPath();
        ctx.moveTo(ns[e.source].x, ns[e.source].y);
        ctx.lineTo(ns[e.target].x, ns[e.target].y);
        ctx.stroke();
      }

      // Nodes
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i];
        const isHovered = hoveredRef.current === i;
        ctx.beginPath();
        ctx.arc(n.x, n.y, isHovered ? 8 : 6, 0, Math.PI * 2);
        ctx.fillStyle = isHovered ? '#fff' : n.color;
        ctx.fill();
        if (isHovered) {
          ctx.strokeStyle = n.color;
          ctx.lineWidth = 2;
          ctx.stroke();
          // Label
          ctx.fillStyle = '#ccc';
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(n.label.slice(0, 30), n.x, n.y - 14);
        }
      }

      animRef.current = requestAnimationFrame(step);
    };

    const timer = setTimeout(() => {
      // After stabilization, just render statically
      running = false;
      cancelAnimationFrame(animRef.current);
      // Final render
      ctx.clearRect(0, 0, W, H);
      for (const e of edgesRef.current) {
        ctx.beginPath();
        ctx.moveTo(nodesRef.current[e.source].x, nodesRef.current[e.source].y);
        ctx.lineTo(nodesRef.current[e.target].x, nodesRef.current[e.target].y);
        ctx.strokeStyle = 'rgba(150,150,150,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      for (let i = 0; i < nodesRef.current.length; i++) {
        const n = nodesRef.current[i];
        ctx.beginPath();
        ctx.arc(n.x, n.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();
      }
    }, 4000);

    animRef.current = requestAnimationFrame(step);
    return () => { running = false; cancelAnimationFrame(animRef.current); clearTimeout(timer); };
  }, [nodes.length, edges]);

  const handleMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Node coords live in the canvas's internal 300x350 space, but the element
    // is laid out with `w-full` and renders narrower — scale the pointer into
    // canvas space or hit-testing drifts further off toward the right edge.
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    let found = -1;
    for (let i = 0; i < nodesRef.current.length; i++) {
      const n = nodesRef.current[i];
      const dx = mx - n.x;
      const dy = my - n.y;
      if (dx * dx + dy * dy < 100) { found = i; break; }
    }
    setHovered(found >= 0 ? found : null);
    canvas.style.cursor = found >= 0 ? 'pointer' : 'default';
  }, []);

  return (
    <div className="p-3 text-xs">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wide text-fg-subtle">Knowledge Graph</div>
        <button onClick={() => void loadGraph()} className="text-[10px] text-accent hover:underline px-1.5 py-0.5 rounded hover:bg-bg-elev">
          Refresh
        </button>
      </div>
      {loading && <div className="text-fg-subtle py-8 text-center">Loading conversations...</div>}
      {!loading && nodes.length === 0 && (
        <div className="text-fg-subtle py-8 text-center">No conversations yet.</div>
      )}
      {nodes.length > 0 && (
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={300}
            height={350}
            onMouseMove={handleMove}
            className="w-full rounded-lg border border-border/60 bg-bg-code/20"
          />
          <div className="mt-2 text-[9px] text-fg-subtle text-center">
            {nodes.length} conversations · {edges.length} links · Hover a node to see its title
          </div>
        </div>
      )}
    </div>
  );
}
