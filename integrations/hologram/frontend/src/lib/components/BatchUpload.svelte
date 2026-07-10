<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { walletState, settingsState, toast } from '../stores/appState.js';
  import { ScanFolder, EstimateBatchGas, DeployTELABatch, IsInSimulatorMode, GetMODsList, GetMetadataFiles, PreflightExpand } from '../../../wailsjs/go/main/App.js';
  import { EventsOn, EventsOff } from '../../../wailsjs/runtime/runtime.js';
  import { ClipboardSetText } from '../../../wailsjs/runtime/runtime.js';
  import { Copy, Eye, AlertTriangle, Search, Clock, Check, X, Puzzle } from 'lucide-svelte';
  
  export let folderPath = '';
  
  const dispatch = createEventDispatcher();
  
  let files = [];
  let loading = false;
  let deploying = false;
  let deployProgress = { current: 0, total: 0, status: '', fileName: '', phase: 'idle' };
  let error = null;
  let errorDetails = null; // Detailed TELA error with fix guidance
  let totalSize = 0;
  let totalGas = 0;
  
  // Track per-file deployment status
  let fileStatuses = {}; // { filename: 'pending' | 'deploying' | 'completed' | 'failed' }
  
  // INDEX metadata
  let indexName = '';
  let indexDURL = '';
  let indexDescription = '';
  let indexIcon = '';
  
  // New: Ringsize, compression, auto-shard, and confirmation
  let ringsize = 2; // 2 = updateable, 16+ = immutable
  let enableCompression = false; // Global compression toggle (matching tela-cli)
  let enableAutoShard = false;   // Opt-in: expand oversized files into shards during preflight
  let preflightExpansion = null; // Result from PreflightExpand when auto-shard is on
  let isSimulator = false;
  let showConfirmModal = false;
  
  // TELA-MODs state (matching tela-cli modsPrompt)
  let enableMods = false;
  let selectedVsMod = '';      // Variable Store MOD (single selection)
  let selectedTxMods = [];     // Transfer MODs (multi-selection)
  let allMods = [];
  let modsLoading = false;
  
  // Deployment result
  let deploymentResult = null; // { indexScid, deployedDocs, durl }
  
  // Event subscriptions
  let unsubscribeStart, unsubscribeProgress, unsubscribeComplete, unsubscribeError;
  let deployStartedAt = 0;
  let waitCycleStartedAt = 0;
  let waitNow = Date.now();
  let waitTicker = null;
  let prefsLoaded = false;
  let indexConfigCardEl = null;
  let deployButtonEl = null;
  let successPrimaryActionEl = null;

  const BATCH_PREFS_KEY = 'hologram.batch_upload.preferences.v1';
  const DEPLOY_STEPS = ['Preflight', 'DOC Deploy', 'Confirmations', 'INDEX', 'Complete'];

  function startWaitTicker() {
    if (waitTicker) return;
    waitTicker = setInterval(() => {
      waitNow = Date.now();
    }, 1000);
  }

  function stopWaitTicker() {
    if (!waitTicker) return;
    clearInterval(waitTicker);
    waitTicker = null;
  }

  function resetWaitTracking() {
    deployStartedAt = 0;
    waitCycleStartedAt = 0;
    stopWaitTicker();
  }

  function getCurrentStepIndex(phase) {
    switch (phase) {
      case 'starting':
      case 'preparing':
      case 'idle':
        return 0;
      case 'deploying':
      case 'completed':
      case 'verifying':
      case 'verify_warning':
        return 1;
      case 'waiting_confirmation':
      case 'waiting_for_docs':
        return 2;
      case 'creating_index':
        return 3;
      case 'complete':
        return 4;
      case 'error':
      default:
        return 0;
    }
  }

  function getStepClass(stepIndex, phase) {
    const current = getCurrentStepIndex(phase);
    if (phase === 'error' && stepIndex === current) return 'error';
    if (stepIndex < current) return 'done';
    if (stepIndex === current) return 'active';
    return 'pending';
  }

  function formatWaitMeta() {
    if (!deployStartedAt) return '';
    const elapsed = Math.max(0, Math.floor((waitNow - deployStartedAt) / 1000));
    const waitingLabel = deployProgress.phase === 'waiting_for_docs'
      ? 'Waiting for DOC confirmations'
      : 'Waiting for block confirmation';
    return `Elapsed ${elapsed}s · ${waitingLabel}`;
  }

  function getWaitGuidance() {
    if (isSimulator) {
      return 'Simulator confirmations are usually quick, but can still pause between steps.';
    }
    return 'Mainnet confirmations can vary. Please wait patiently.';
  }

  function savePreferences() {
    if (!prefsLoaded || typeof localStorage === 'undefined') return;
    const prefs = {
      indexName,
      indexDURL,
      indexDescription,
      indexIcon,
      ringsize,
      enableCompression,
      enableAutoShard,
      enableMods,
      selectedVsMod,
      selectedTxMods,
    };
    try {
      localStorage.setItem(BATCH_PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
      // Ignore storage failures in constrained environments.
    }
  }

  function loadPreferences() {
    if (typeof localStorage === 'undefined') {
      prefsLoaded = true;
      return;
    }
    try {
      const raw = localStorage.getItem(BATCH_PREFS_KEY);
      if (!raw) {
        prefsLoaded = true;
        return;
      }
      const prefs = JSON.parse(raw);
      indexName = prefs.indexName || '';
      indexDURL = prefs.indexDURL || '';
      indexDescription = prefs.indexDescription || '';
      indexIcon = prefs.indexIcon || '';
      ringsize = prefs.ringsize || 2;
      enableCompression = prefs.enableCompression === true;
      enableAutoShard = prefs.enableAutoShard === true;
      enableMods = prefs.enableMods === true;
      selectedVsMod = prefs.selectedVsMod || '';
      selectedTxMods = Array.isArray(prefs.selectedTxMods) ? prefs.selectedTxMods : [];
    } catch (e) {
      // Ignore corrupt preference payloads and continue with defaults.
    } finally {
      prefsLoaded = true;
    }
  }

  function focusIndexConfig() {
    indexConfigCardEl?.focus();
  }

  function focusDeployAction() {
    deployButtonEl?.focus();
  }
  
  onMount(async () => {
    loadPreferences();

    // Check if we're in simulator mode
    try {
      const result = await IsInSimulatorMode();
      isSimulator = result === true;
    } catch (e) {
      isSimulator = false;
    }
    
    // Subscribe to deployment events
    unsubscribeStart = EventsOn('tela:deploy:start', (data) => {
      if (!deployStartedAt) {
        deployStartedAt = Date.now();
        waitNow = deployStartedAt;
      }
      startWaitTicker();
      deployProgress = { 
        current: 0, 
        total: data.totalFiles, 
        status: 'Starting deployment...', 
        fileName: '',
        phase: 'starting'
      };
      // Initialize all files as pending
      fileStatuses = {};
      files.forEach(f => fileStatuses[f.name] = 'pending');
    });
    
    unsubscribeProgress = EventsOn('tela:deploy:progress', (data) => {
      if (data.status === 'waiting_confirmation' || data.status === 'waiting_for_docs') {
        if (!waitCycleStartedAt) waitCycleStartedAt = Date.now();
        if (!deployStartedAt) {
          deployStartedAt = waitCycleStartedAt;
        }
        startWaitTicker();
      } else if (waitCycleStartedAt) {
        waitCycleStartedAt = 0;
      }

      deployProgress = {
        current: data.current,
        total: data.total,
        status: data.status === 'deploying' ? `Deploying ${data.fileName}...` :
                data.status === 'completed' ? `Deployed ${data.fileName}` :
                data.status === 'waiting_confirmation' ? `Waiting for block confirmation...` :
                data.status === 'waiting_for_docs' ? 'Waiting for DOC confirmations...' :
                data.status === 'verifying' ? `Verifying ${data.fileName}...` :
                data.status === 'verify_warning' ? `[WARN] ${data.fileName} may need re-deploy` :
                data.status === 'creating_index' ? 'Creating INDEX...' : data.status,
        fileName: data.fileName,
        phase: data.status,
        warning: data.warning
      };
      
      // Update file status
      if (data.status === 'deploying') {
        fileStatuses[data.fileName] = 'deploying';
      } else if (data.status === 'completed') {
        fileStatuses[data.fileName] = 'completed';
      } else if (data.status === 'waiting_confirmation') {
        fileStatuses[data.fileName] = 'waiting';
      } else if (data.status === 'verifying') {
        fileStatuses[data.fileName] = 'verifying';
      } else if (data.status === 'verify_warning') {
        fileStatuses[data.fileName] = 'warning';
      }
      fileStatuses = fileStatuses; // Trigger reactivity
    });
    
    unsubscribeComplete = EventsOn('tela:deploy:complete', (data) => {
      resetWaitTracking();
      deployProgress = {
        current: data.totalFiles,
        total: data.totalFiles,
        status: 'Deployment complete!',
        fileName: '',
        phase: 'complete'
      };
      deploying = false;
      
      // Store the deployment result for display
      deploymentResult = {
        indexScid: data.indexScid,
        deployedDocs: data.deployedDocs,
        durl: data.durl,
      };
      
      // Keep this concise; full SCID is available in the result panel and copy action.
      toast.success('Deployment complete!');

      // Move keyboard focus to primary success action for faster follow-up operations.
      setTimeout(() => {
        successPrimaryActionEl?.focus();
      }, 0);
      
      dispatch('complete', {
        indexScid: data.indexScid,
        deployedDocs: data.deployedDocs,
        durl: data.durl,
      });
    });
    
    unsubscribeError = EventsOn('tela:deploy:error', (data) => {
      resetWaitTracking();
      // Check if this is a detailed TELA error with fix guidance
      if (data.isTELAError && data.description) {
        error = data.error;
        errorDetails = {
          description: data.description,
          fix: data.fix,
          example: data.example,
          fileName: data.fileName,
          technicalError: data.technicalError
        };
      } else {
        error = data.error;
        errorDetails = null;
      }
      deploying = false;
      if (data?.error) {
        toast.error(data.error);
      }
      if (data.fileName) {
        fileStatuses[data.fileName] = 'failed';
        fileStatuses = fileStatuses;
      }
      deployProgress.phase = 'error';
    });
  });
  
  onDestroy(() => {
    resetWaitTracking();
    if (unsubscribeStart) unsubscribeStart();
    if (unsubscribeProgress) unsubscribeProgress();
    if (unsubscribeComplete) unsubscribeComplete();
    if (unsubscribeError) unsubscribeError();
  });

  $: if (prefsLoaded) {
    savePreferences();
  }
  
  // Load MODs data when MODs are enabled
  async function loadModsData() {
    if (modsLoading || allMods.length > 0) return;
    modsLoading = true;
    try {
      const result = await GetMODsList();
      if (result.success && result.mods) {
        allMods = result.mods;
      }
    } catch (e) {
      console.error('Failed to load MODs:', e);
    } finally {
      modsLoading = false;
    }
  }
  
  // Get MODs grouped by class
  function getVsModOptions() {
    return allMods.filter(m => m.tag?.startsWith('vs'));
  }
  
  function getTxModOptions() {
    return allMods.filter(m => m.tag?.startsWith('tx'));
  }
  
  // Toggle a Transfer MOD
  function toggleTxMod(tag) {
    if (selectedTxMods.includes(tag)) {
      selectedTxMods = selectedTxMods.filter(t => t !== tag);
    } else {
      selectedTxMods = [...selectedTxMods, tag];
    }
  }
  
  // Get combined MOD tags string
  function getModTags() {
    const tags = [];
    if (selectedVsMod) tags.push(selectedVsMod);
    tags.push(...selectedTxMods);
    return tags.join(',');
  }
  
  // Icon URL Validation
  function validateIconURL(url) {
    if (!url || url.trim() === '') {
      return { valid: true, type: 'empty', message: '' };
    }
    
    const trimmed = url.trim();
    
    // Check if it's a valid SCID (64 hex characters)
    const scidPattern = /^[a-fA-F0-9]{64}$/;
    if (scidPattern.test(trimmed)) {
      return { valid: true, type: 'scid', message: 'Valid SCID (on-chain reference)' };
    }
    
    // Check for HTTPS URL
    if (trimmed.startsWith('https://')) {
      try {
        new URL(trimmed);
        return { valid: true, type: 'https', message: 'HTTPS URL' };
      } catch {
        return { valid: false, type: 'invalid', message: 'Invalid URL format' };
      }
    }
    
    // Check for HTTP URL (warning)
    if (trimmed.startsWith('http://')) {
      try {
        new URL(trimmed);
        return { valid: true, type: 'http', message: 'HTTP URL (HTTPS recommended)', warning: true };
      } catch {
        return { valid: false, type: 'invalid', message: 'Invalid URL format' };
      }
    }
    
    // Check for IPFS
    if (trimmed.startsWith('ipfs://')) {
      return { valid: true, type: 'ipfs', message: 'IPFS reference' };
    }
    
    // Unknown format
    return { valid: false, type: 'unknown', message: 'Use HTTPS URL, SCID (64 chars), or IPFS' };
  }
  
  // Reactive icon validation
  $: iconValidation = validateIconURL(indexIcon);
  
  // dURL Tag Detection (suffixes must match backend conventions in blockchain.go)
  const DURL_TAGS = {
    '.tela.lib': { name: 'Library', icon: 'lib', description: 'A collection of reusable DOCs', color: 'violet' },
    '.tela.shard': { name: 'DocShard', icon: 'shard', description: 'A shard DOC (part of a larger file)', color: 'cyan' },
    '.tela.shards': { name: 'DocShards', icon: 'shards', description: 'DocShards INDEX that requires reconstruction', color: 'cyan' },
    '.tela.bootstrap': { name: 'Bootstrap', icon: 'bootstrap', description: 'A collection of TELA apps for bootstrapping', color: 'amber' }
  };
  
  function detectDurlTag(durl) {
    if (!durl || durl.trim() === '') return null;
    const trimmed = durl.trim().toLowerCase();
    for (const [tag, info] of Object.entries(DURL_TAGS)) {
      if (trimmed.endsWith(tag)) return { tag, ...info };
    }
    if (trimmed.endsWith('.tela')) {
      return { tag: '.tela', name: 'Standard', icon: '◇', description: 'Standard TELA application', color: 'default' };
    }
    return null;
  }
  
  $: durlTag = detectDurlTag(indexDURL);

  // Detect shard folder and warn if dURL suffix is wrong
  $: isShardFolder = (() => {
    if (!folderPath) return false;
    const parts = folderPath.split(/[/\\]/);
    const folderName = (parts[parts.length - 1] || '').toLowerCase();
    return folderName.endsWith('.shards') || folderName.endsWith('.shard');
  })();

  $: hasAutoShardGroups = enableAutoShard && preflightExpansion
    && preflightExpansion.shardGroups && preflightExpansion.shardGroups.length > 0;

  // Auto-adjust dURL when auto-shard produces shard groups
  $: if (hasAutoShardGroups && indexDURL && !indexDURL.toLowerCase().endsWith('.tela.shards')) {
    const base = indexDURL.replace(/\.tela(?:\.\w+)?$/, '');
    indexDURL = base + '.tela.shards';
  }

  $: shardDurlWarning = (() => {
    const needsShardSuffix = isShardFolder || hasAutoShardGroups;
    if (!needsShardSuffix) return null;
    const d = (indexDURL || '').trim().toLowerCase();
    if (!d) return 'Shards detected — dURL should end with .tela.shards for reconstruction to work';
    if (d.endsWith('.tela.shards')) return null;
    if (d.endsWith('.shards') || d.endsWith('.shard'))
      return 'dURL needs full .tela.shards suffix for shard reconstruction (not just .' + d.split('.').pop() + ')';
    return 'Shards detected — dURL should end with .tela.shards for reconstruction to work';
  })();

  // =====================================================
  // Metadata Auto-Inference (from tela-dragdrop-autoshard-plugin)
  // =====================================================
  
  const GENERIC_HTML_TITLES = new Set(['app', 'index', 'untitled', 'vite app', 'react app', 'document']);

  function extractHtmlTitle(content) {
    const match = String(content || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? match[1].replace(/\s+/g, ' ').trim() : '';
  }

  function extractHtmlMetaDescription(content) {
    const match = String(content || '').match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)
        || String(content || '').match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i);
    return match ? match[1].trim() : '';
  }

  function extractHtmlIcon(content) {
    const matches = String(content || '').matchAll(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/gi);
    for (const match of matches) {
      const value = String(match[1] || '').trim();
      if (value && (value.startsWith('http') || /^[0-9a-fA-F]{64}$/.test(value))) {
        return value;
      }
    }
    return '';
  }

  function firstMarkdownHeading(content) {
    const match = String(content || '').match(/^\s*#\s+(.+)$/m);
    return match ? match[1].trim() : '';
  }

  function parseJsonSafe(content) {
    try {
      return JSON.parse(String(content || ''));
    } catch {
      return null;
    }
  }

  function humanizeImportName(value) {
    const normalized = String(value || '')
      .replace(/^@[^/]+\//, '')
      .split('/')
      .at(-1) || '';
    return normalized.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim() || 'imported-app';
  }

  function defaultDurl(name) {
    const slug = String(name || 'tela-app')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tela-app';
    return `${slug}.tela`;
  }

  async function inferMetadataFromFolder() {
    if (!folderPath) return;
    
    try {
      const meta = await GetMetadataFiles(folderPath);
      if (!meta.success) return;

      let inferredName = '';
      let inferredDescription = '';
      let inferredIcon = '';

      // 1. Parse package.json
      const packageJson = parseJsonSafe(meta.packageJson);
      if (packageJson && typeof packageJson === 'object') {
        if (typeof packageJson.displayName === 'string' && packageJson.displayName.trim()) {
          inferredName = packageJson.displayName.trim();
        } else if (typeof packageJson.name === 'string' && packageJson.name.trim()) {
          inferredName = humanizeImportName(packageJson.name);
        }
        if (typeof packageJson.description === 'string' && packageJson.description.trim()) {
          inferredDescription = packageJson.description.trim();
        }
        if (typeof packageJson.icon === 'string') {
          const iconVal = packageJson.icon.trim();
          if (iconVal.startsWith('http') || /^[0-9a-fA-F]{64}$/.test(iconVal)) {
            inferredIcon = iconVal;
          }
        }
      }

      // 2. Parse index.html (can override name if better)
      const htmlContent = meta.indexHtml || '';
      const htmlTitle = extractHtmlTitle(htmlContent);
      if (htmlTitle && !GENERIC_HTML_TITLES.has(htmlTitle.toLowerCase())) {
        inferredName = htmlTitle;
      }
      if (!inferredDescription) {
        inferredDescription = extractHtmlMetaDescription(htmlContent);
      }
      if (!inferredIcon) {
        inferredIcon = extractHtmlIcon(htmlContent);
      }

      // 3. Parse README for description fallback
      if (!inferredDescription && meta.readme) {
        inferredDescription = firstMarkdownHeading(meta.readme);
      }

      // Apply inferred values (only if fields are currently empty)
      if (inferredName && !indexName) {
        indexName = inferredName;
      }
      if (!indexDURL && indexName) {
        indexDURL = defaultDurl(indexName);
      }
      if (inferredDescription && !indexDescription) {
        indexDescription = inferredDescription;
      }
      if (inferredIcon && !indexIcon) {
        indexIcon = inferredIcon;
      }

    } catch (e) {
      console.warn('[BatchUpload] Metadata inference failed:', e);
    }
  }

  // =====================================================
  // Preflight Analysis (inspired by tela-dragdrop-autoshard-plugin)
  // =====================================================
  
  const MAX_DOC_SIZE_KB = 18; // Files larger than this would need sharding
  const MAX_DOC_SIZE_BYTES = MAX_DOC_SIZE_KB * 1024;
  // Conservative estimate: GZIP typically achieves ~45% reduction on text/code assets.
  // Using 0.55 as the compression factor avoids false-positive "too large" warnings
  // for files that will compress below the limit. Binary/already-compressed files
  // compress poorly, so this heuristic errs on the side of letting them through too —
  // the backend enforces the hard limit at deploy time regardless.
  const GZIP_COMPRESSION_FACTOR = 0.55;

  $: preflightStats = (() => {
    if (!files || files.length === 0) {
      return { sourceFiles: 0, deployDocs: 0, oversizedFiles: [], hasOversized: false };
    }

    const effectiveMax = enableCompression
      ? MAX_DOC_SIZE_BYTES / GZIP_COMPRESSION_FACTOR
      : MAX_DOC_SIZE_BYTES;

    const oversizedFiles = files.filter(f => f.size > effectiveMax);
    let deployDocs = files.length;

    // Each oversized file would become multiple shards
    for (const file of oversizedFiles) {
      const shardCount = Math.ceil(file.size / effectiveMax);
      deployDocs += (shardCount - 1); // -1 because original file is already counted
    }

    return {
      sourceFiles: files.length,
      deployDocs,
      oversizedFiles,
      hasOversized: oversizedFiles.length > 0
    };
  })();

  // Watch for MODs toggle to load MODs and force ringsize
  $: if (enableMods) {
    if (allMods.length === 0 && !modsLoading) {
      loadModsData();
    }
    ringsize = 2; // MODs require ringsize 2
  }
  
  $: if (folderPath) {
    scanFolder();
  }
  
  // Estimated gas (for display only - actual gas is calculated per-transaction)
  let estimatedGas = 0;
  
  async function scanFolder() {
    if (!folderPath) return;
    
    loading = true;
    error = null;
    preflightExpansion = null;
    
    try {
      let scanSuccess = false;

      if (enableAutoShard) {
        const config = JSON.stringify({ autoShard: true, compress: enableCompression });
        const result = await PreflightExpand(folderPath, config);
        if (result.success) {
          files = result.deployFiles || [];
          preflightExpansion = {
            deployFiles: result.deployFiles || [],
            shardGroups: result.shardGroups || [],
            warnings: result.warnings || [],
            summary: result.summary || {},
          };
          totalSize = preflightExpansion.summary.totalSourceBytes || 0;
          totalGas = preflightExpansion.summary.estimatedGas || 0;
          estimatedGas = totalGas;
          scanSuccess = true;
        } else {
          error = result.error;
        }
      } else {
        const result = await ScanFolder(folderPath);
        if (result.success) {
          files = result.files || [];
          totalSize = result.totalSize || 0;
          totalGas = result.totalGas || 0;
          estimatedGas = result.estimatedGas || result.totalGas || 0;
          scanSuccess = true;
        } else {
          error = result.error;
        }
      }

      if (scanSuccess) {
        // Auto-infer metadata from package.json, index.html, README
        await inferMetadataFromFolder();
        
        // Fallback: if metadata inference didn't find a name, use folder name
        if (!indexName) {
          const parts = folderPath.split(/[/\\]/);
          indexName = parts[parts.length - 1] || 'My TELA App';
          if (!indexDURL) {
            indexDURL = defaultDurl(indexName);
          }
        }
      }
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }
  
  function updateDocType(index, newType) {
    files[index].docType = newType;
    files = files; // Trigger reactivity
  }
  
  function removeFile(index) {
    files = files.filter((_, i) => i !== index);
    recalculateTotals();
  }
  
  function recalculateTotals() {
    totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
    totalGas = files.reduce((sum, f) => sum + (f.gasEstimate || 0), 0);
  }
  
  // Prepare deployment - show confirmation for Mainnet, auto-deploy for Simulator
  function prepareDeploy() {
    // Check wallet - allow in simulator mode or with wallet open
    if (!$walletState.isOpen && !isSimulator) {
      error = 'Please open a wallet first';
      return;
    }
    
    if (!indexName) {
      error = 'Please enter an application name';
      return;
    }
    
    if (files.length === 0) {
      error = 'No files to deploy';
      return;
    }
    
    error = null;
    
    // In simulator mode, deploy immediately (free transactions)
    if (isSimulator) {
      deploy();
    } else {
      // Show confirmation modal for Mainnet
      showConfirmModal = true;
    }
  }
  
  function cancelDeploy() {
    showConfirmModal = false;
  }
  
  async function confirmDeploy() {
    showConfirmModal = false;
    await deploy();
  }
  
  async function deploy() {
    deploying = true;
    error = null;
    deploymentResult = null;
    deployStartedAt = Date.now();
    waitNow = deployStartedAt;
    waitCycleStartedAt = 0;
    startWaitTicker();
    deployProgress = { current: 0, total: files.length, status: 'Preparing...', fileName: '', phase: 'preparing' };
    
    // Initialize file statuses
    fileStatuses = {};
    files.forEach(f => fileStatuses[f.name] = 'pending');
    
    try {
      const batchData = {
        files: files.map(f => ({
          name: f.name,
          path: f.path || '',
          data: f.data || '',  // populated for virtual shard DOCs from PreflightExpand
          subDir: f.subDir,
          docType: f.docType,
          size: f.size,
          // For virtual shards, compression was already applied by PreflightExpand — trust f.compressed.
          // For regular entries, derive from the toggle.
          compressed: f.data ? (f.compressed || false) : (enableCompression && (f.canCompress || false)),
          ringsize: ringsize,
        })),
        indexName: indexName,
        indexDurl: indexDURL,
        description: indexDescription,
        iconUrl: indexIcon,
        ringsize: ringsize,
        mods: enableMods ? getModTags() : '', // MOD tags if enabled
      };
      
      // Note: Events will handle progress updates and completion
      const result = await DeployTELABatch(JSON.stringify(batchData));
      
      // Fallback if events didn't fire (shouldn't happen)
      if (!result.success && !error) {
        error = result.error;
        deploying = false;
        resetWaitTracking();
      }
    } catch (err) {
      error = err.message;
      deploying = false;
      resetWaitTracking();
    }
  }
  
  // Copy SCID to clipboard with toast notification
  function copyScid(scid, label = 'SCID') {
    ClipboardSetText(scid);
    toast.success(`${label} copied to clipboard`);
  }

  function copyText(value, label = 'Value') {
    if (!value) return;
    ClipboardSetText(value);
    toast.success(`${label} copied to clipboard`);
  }

  function copyAllDocScids() {
    if (!deploymentResult?.deployedDocs?.length) return;
    const payload = deploymentResult.deployedDocs
      .map((doc) => `${doc.name}: ${doc.scid}`)
      .join('\n');
    ClipboardSetText(payload);
    toast.success('All DOC SCIDs copied to clipboard');
  }

  function copyErrorDiagnostics() {
    const diagnostics = [
      `Source Folder: ${folderPath || '(unknown)'}`,
      `Error: ${error || '(none)'}`,
      `Phase: ${deployProgress?.phase || 'idle'}`,
      `Status: ${deployProgress?.status || '(none)'}`,
      `Current/Total: ${deployProgress?.current || 0}/${deployProgress?.total || 0}`,
      '',
      'Settings:',
      `- autoShard: ${enableAutoShard}`,
      `- compression: ${enableCompression}`,
      `- ringsize: ${ringsize}`,
      `- mods: ${enableMods ? getModTags() || '(enabled, none selected)' : '(disabled)'}`,
      '',
      'Details:',
      JSON.stringify(errorDetails || {}, null, 2),
    ].join('\n');
    ClipboardSetText(diagnostics);
    toast.success('Diagnostics copied to clipboard');
  }
  
  // Preview deployed INDEX in browser
  function previewIndex(scid) {
    dispatch('preview', { scid, type: 'index' });
  }
  
  // Update SubDir for a file
  function updateSubDir(index, newSubDir) {
    files[index].subDir = newSubDir;
    files = files; // Trigger reactivity
  }
  
  // Reset to deploy another batch
  function resetDeployment() {
    deploymentResult = null;
    deployProgress = { current: 0, total: 0, status: '', fileName: '', phase: 'idle' };
    fileStatuses = {};
    resetWaitTracking();
  }
  
  function getFileStatus(fileName) {
    return fileStatuses[fileName] || 'pending';
  }
  
  function getStatusIcon(status) {
    switch(status) {
      case 'pending': return '○';
      case 'deploying': return '◎';
      case 'completed': return '✓';
      case 'failed': return '✗';
      case 'waiting': return '●';
      case 'verifying': return '◎';
      case 'warning': return '⚠';
      default: return '○';
    }
  }
  
  function getStatusColor(status) {
    switch(status) {
      case 'pending': return 'status-pending';
      case 'deploying': return 'status-deploying';
      case 'completed': return 'status-completed';
      case 'failed': return 'status-failed';
      case 'waiting': return 'status-waiting';
      case 'verifying': return 'status-verifying';
      case 'warning': return 'status-warning';
      default: return 'status-pending';
    }
  }
  
  function getDocTypeIcon(docType) {
    const icons = {
      // TELA types (from backend)
      'TELA-HTML-1': '◇',
      'TELA-CSS-1': '◈',
      'TELA-JS-1': '⬡',
      'TELA-JSON-1': '□',
      'TELA-MD-1': '◊',
      'TELA-GO-1': '◆',
      'TELA-STATIC-1': '○',
      // Standard MIME types (fallback)
      'text/html': '◇',
      'text/css': '◈',
      'application/javascript': '⬡',
      'application/json': '□',
      'image/svg+xml': '◎',
      'image/png': '◎',
      'image/jpeg': '◎',
      'image/gif': '◎',
      'image/webp': '◎',
      'text/markdown': '◊',
    };
    return icons[docType] || '○';
  }
  
  function getDocTypeLabel(docType) {
    // TELA uses specific type constants like "TELA-CSS-1"
    const labels = {
      // TELA types (from backend)
      'TELA-HTML-1': 'HTML',
      'TELA-CSS-1': 'CSS',
      'TELA-JS-1': 'JS',
      'TELA-JSON-1': 'JSON',
      'TELA-MD-1': 'MD',
      'TELA-GO-1': 'GO',
      'TELA-STATIC-1': 'FILE',
      // Standard MIME types (fallback)
      'text/html': 'HTML',
      'text/css': 'CSS',
      'application/javascript': 'JS',
      'application/json': 'JSON',
      'image/svg+xml': 'SVG',
      'image/png': 'PNG',
      'image/jpeg': 'JPEG',
      'image/gif': 'GIF',
      'image/webp': 'WebP',
      'text/markdown': 'MD',
      'application/octet-stream': 'BIN',
    };
    return labels[docType] || 'FILE';
  }
  
  function getDocTypeClass(docType) {
    // Return CSS class for color-coding file types
    const classes = {
      'TELA-HTML-1': 'type-html',
      'TELA-CSS-1': 'type-css',
      'TELA-JS-1': 'type-js',
      'TELA-JSON-1': 'type-json',
      'TELA-MD-1': 'type-md',
      'TELA-GO-1': 'type-go',
      'TELA-STATIC-1': 'type-static',
    };
    return classes[docType] || 'type-static';
  }
  
  // #2: Determine if file type detection is confident (extension matches type)
  function isConfidentDetection(filename, docType) {
    const ext = filename.split('.').pop()?.toLowerCase();
    const confidentMappings = {
      'html': 'TELA-HTML-1',
      'htm': 'TELA-HTML-1',
      'css': 'TELA-CSS-1',
      'js': 'TELA-JS-1',
      'mjs': 'TELA-JS-1',
      'json': 'TELA-JSON-1',
      'md': 'TELA-MD-1',
      'markdown': 'TELA-MD-1',
      'go': 'TELA-GO-1',
    };
    return confidentMappings[ext] === docType;
  }
  
  // #3: Get tooltip text explaining why a file is marked as entry point
  function getEntryPointTooltip(filename) {
    const name = filename.toLowerCase();
    if (name === 'index.html' || name === 'index.htm') {
      return 'Auto-detected: index.html is the default TELA entry point';
    }
    return 'Marked as application entry point';
  }
  
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }
  
  // Check if any files can benefit from compression (text-based types)
  function hasCompressibleFiles() {
    return files.some(f => f.canCompress === true);
  }
</script>

<div class="batch-upload">
  <div class="keyboard-quick-nav" aria-label="Batch upload keyboard shortcuts">
    <button type="button" class="quick-nav-btn" on:click={focusIndexConfig}>
      Skip to INDEX config
    </button>
    <button type="button" class="quick-nav-btn" on:click={focusDeployAction}>
      Skip to deploy action
    </button>
  </div>

  <!-- Folder Info -->
  <div class="folder-info">
    <div class="folder-info-content">
      <div>
        <span class="folder-label">Source Folder</span>
        <p class="folder-path">{folderPath}</p>
      </div>
      <button 
        on:click={scanFolder}
        disabled={loading}
        class="btn-rescan"
      >
        {loading ? 'Scanning...' : '↻ Rescan'}
      </button>
    </div>
  </div>
  
  <!-- Error Display -->
  {#if error}
    <div class="alert-error">
      <span class="alert-icon">!</span> {error}
    </div>
    {#if errorDetails}
      <div class="error-details">
        {#if errorDetails.fileName}
          <div class="error-file">File: <code>{errorDetails.fileName}</code></div>
        {/if}
        {#if errorDetails.description}
          <div class="error-section">
            <div class="error-section-title">What happened:</div>
            <div class="error-section-content">{errorDetails.description}</div>
          </div>
        {/if}
        {#if errorDetails.fix}
          <div class="error-section">
            <div class="error-section-title">How to fix:</div>
            <div class="error-section-content">{errorDetails.fix}</div>
          </div>
        {/if}
        {#if errorDetails.example}
          <div class="error-section">
            <div class="error-section-title">Example:</div>
            <pre class="error-example">{errorDetails.example}</pre>
          </div>
        {/if}
        <button class="error-dismiss" on:click={() => { error = null; errorDetails = null; }}>
          Dismiss
        </button>
        <button class="error-dismiss" on:click={copyErrorDiagnostics}>
          Copy diagnostics
        </button>
      </div>
    {/if}
  {/if}
  
  <!-- Files List -->
  {#if loading}
    <div class="loading-state">
      <div class="spinner"></div>
      <p class="loading-text">Scanning folder...</p>
    </div>
  {:else if files.length > 0}
    <div class="files-container">
      <div class="files-header">
        <span class="files-count">{files.length} files • {formatSize(totalSize)}</span>
        <span class="files-gas">~{totalGas.toLocaleString()} rough gas</span>
        {#if isSimulator}
          <span class="files-free-badge" title="Gas is free in simulator mode">FREE</span>
        {/if}
      </div>
      
      <!-- Preflight Summary Panel -->
      {#if !deploying && !deploymentResult}
        <div class="preflight-summary">
          <div class="preflight-stats">
            <div class="preflight-stat">
              <span class="preflight-stat-value">
                {enableAutoShard && preflightExpansion
                  ? (preflightExpansion.summary.sourceFileCount ?? preflightStats.sourceFiles)
                  : preflightStats.sourceFiles}
              </span>
              <span class="preflight-stat-label">Source Files</span>
            </div>
            <div class="preflight-stat-arrow">→</div>
            <div class="preflight-stat">
              <span class="preflight-stat-value">
                {enableAutoShard && preflightExpansion
                  ? (preflightExpansion.summary.deployDocCount ?? preflightStats.deployDocs)
                  : preflightStats.deployDocs}
              </span>
              <span class="preflight-stat-label">DOC Contracts</span>
            </div>
            <div class="preflight-stat-plus">+</div>
            <div class="preflight-stat">
              <span class="preflight-stat-value">1</span>
              <span class="preflight-stat-label">INDEX Contract</span>
            </div>
            {#if enableAutoShard && preflightExpansion && preflightExpansion.summary.estimatedGas}
              <div class="preflight-stat-plus">•</div>
              <div class="preflight-stat">
                <span class="preflight-stat-value">~{preflightExpansion.summary.estimatedGas.toLocaleString()}</span>
                <span class="preflight-stat-label">Rough Est. Gas</span>
              </div>
            {/if}
          </div>
          
          {#if enableAutoShard && preflightExpansion}
            {#if preflightExpansion.shardGroups && preflightExpansion.shardGroups.length > 0}
              <div class="preflight-shard-callout">
                <span class="preflight-shard-icon">◈</span>
                <span>
                  {preflightExpansion.shardGroups.length} file{preflightExpansion.shardGroups.length > 1 ? 's' : ''} will be split into shards:
                  {preflightExpansion.shardGroups.map(g => `${g.originalName} → ${g.shardCount} shards`).join(', ')}
                </span>
              </div>
            {/if}
            {#if preflightExpansion.warnings && preflightExpansion.warnings.length > 0}
              {#each preflightExpansion.warnings as warn}
                <div class="preflight-warning">
                  <AlertTriangle size={14} />
                  <span>{warn}</span>
                </div>
              {/each}
            {/if}
          {:else if preflightStats.hasOversized}
            <div class="preflight-warning">
              <AlertTriangle size={14} />
              <span>
                {preflightStats.oversizedFiles.length} file{preflightStats.oversizedFiles.length > 1 ? 's' : ''} exceed{preflightStats.oversizedFiles.length === 1 ? 's' : ''} 18KB limit:
                {preflightStats.oversizedFiles.map(f => f.name).join(', ')}
              </span>
              <button
                type="button"
                class="btn-enable-autoshard"
                on:click={() => { enableAutoShard = true; scanFolder(); }}
                disabled={deploying}
              >
                Enable Auto-Shard
              </button>
            </div>
            <div class="preflight-hint">
              Large files will fail deployment. Enable Auto-Shard above to split them automatically, or use DocShard Manager in Studio.
            </div>
          {/if}
        </div>
      {/if}
      
      <div class="files-list">
        {#each files as file, i}
          {@const status = getFileStatus(file.name)}
          <div class="file-row {status === 'deploying' ? 'highlight-deploying' : status === 'completed' ? 'highlight-completed' : ''}">
            {#if deploying}
              <span class="file-icon {getStatusColor(status)}">{getStatusIcon(status)}</span>
            {:else}
              <span class="file-icon">{getDocTypeIcon(file.docType)}</span>
            {/if}
            
            <div class="file-info">
              <div class="file-name-row">
                <span class="file-name">{file.name}</span>
                {#if file.isEntryPoint}
                  <span class="badge-entry" title={getEntryPointTooltip(file.name)}>
                    <span class="entry-icon">◇</span> Entry
                  </span>
                {/if}
                {#if deploying && status === 'deploying'}
                  <span class="badge-deploying">Deploying</span>
                {/if}
              </div>
              <div class="file-meta">
                {#if !deploying}
                  <input
                    type="text"
                    value={file.subDir}
                    on:input={(e) => updateSubDir(i, e.target.value)}
                    class="subdir-input"
                    placeholder="/"
                    title="SubDir path"
                  />
                {:else}
                  <span class="subdir-display">{file.subDir || '/'}</span>
                {/if}
                <span class="file-size">• {formatSize(file.size)}</span>
              </div>
            </div>
            
            <!-- #5: Compression indicator -->
            {#if enableCompression && file.canCompress}
              <span class="compress-badge" title="Will be gzip compressed for smaller on-chain size">
                <span class="compress-icon">Z</span>
              </span>
            {/if}
            
            <!-- #2: Only show dropdown for non-confident detections -->
            {#if isConfidentDetection(file.name, file.docType)}
              <!-- Confident detection: just show badge, no dropdown -->
              <span 
                class="file-type-badge {getDocTypeClass(file.docType)} confident" 
                title="Auto-detected from .{file.name.split('.').pop()} extension"
              >
                {getDocTypeLabel(file.docType)}
              </span>
            {:else}
              <!-- Ambiguous: show badge + dropdown -->
              <div class="file-type-wrapper">
                <span 
                  class="file-type-badge {getDocTypeClass(file.docType)}" 
                  title="Type may need verification"
                >
                  {getDocTypeLabel(file.docType)}
                </span>
                <select
                  value={file.docType}
                  on:change={(e) => updateDocType(i, e.target.value)}
                  disabled={deploying}
                  class="file-type-select"
                  title="Select correct file type"
                >
                  <option value="TELA-HTML-1">HTML</option>
                  <option value="TELA-CSS-1">CSS</option>
                  <option value="TELA-JS-1">JavaScript</option>
                  <option value="TELA-JSON-1">JSON</option>
                  <option value="TELA-MD-1">Markdown</option>
                  <option value="TELA-GO-1">Go</option>
                  <option value="TELA-STATIC-1">Static/Binary</option>
                </select>
              </div>
            {/if}
            
            <button
              on:click={() => removeFile(i)}
              disabled={deploying}
              class="file-remove-btn"
            >✕</button>
          </div>
        {/each}
      </div>
    </div>
    
    <!-- Deployment Progress Bar -->
    {#if deploying}
      <div class="progress-card">
        <div class="progress-live-chip">
          <span class="progress-chip-dot"></span>
          <span>Deploy in progress</span>
          <span class="progress-chip-network">{isSimulator ? 'Simulator FREE' : 'Mainnet paid'}</span>
        </div>
        <div class="progress-header">
          <span class="progress-status">{deployProgress.status}</span>
          <span class="progress-count">{deployProgress.current}/{deployProgress.total}</span>
        </div>
        <div class="progress-steps">
          {#each DEPLOY_STEPS as label, stepIndex}
            <div class="progress-step {getStepClass(stepIndex, deployProgress.phase)}">
              <span class="step-dot"></span>
              <span>{label}</span>
            </div>
          {/each}
        </div>
        <div class="progress-bar-bg">
          <div 
            class="progress-bar-fill"
            style="width: {deployProgress.total > 0 ? (deployProgress.current / deployProgress.total) * 100 : 0}%"
          ></div>
        </div>
        {#if deployProgress.phase === 'waiting_confirmation' || deployProgress.phase === 'waiting_for_docs'}
          <p class="progress-note info">⏱ {formatWaitMeta()}</p>
          <p class="progress-note hint">{getWaitGuidance()}</p>
        {:else if deployProgress.phase === 'creating_index'}
          <p class="progress-note success">Creating INDEX smart contract...</p>
        {:else if deployProgress.phase === 'complete'}
          <p class="progress-note success">✓ All files deployed successfully!</p>
        {/if}
      </div>
    {/if}
    
    <!-- INDEX Configuration -->
    <div class="config-card {deploying ? 'disabled' : ''}" bind:this={indexConfigCardEl} tabindex="-1">
      <h3 class="config-title">INDEX Configuration</h3>
      
      <div class="config-grid">
        <div class="config-field">
          <label class="config-label">Application Name <span class="required">*</span></label>
          <input
            type="text"
            bind:value={indexName}
            placeholder="My TELA App"
            disabled={deploying}
            class="config-input"
          />
        </div>
        
        <div class="config-field">
          <label class="config-label">
            dURL (optional)
            {#if durlTag}
              <span class="durl-tag-badge" class:tag-violet={durlTag.color === 'violet'} class:tag-cyan={durlTag.color === 'cyan'} class:tag-amber={durlTag.color === 'amber'}>
                <span class="tag-icon">{durlTag.icon}</span>
                {durlTag.name}
              </span>
            {/if}
          </label>
          <input
            type="text"
            bind:value={indexDURL}
            placeholder="my-app.tela"
            disabled={deploying}
            class="config-input"
          />
          {#if durlTag && durlTag.tag !== '.tela'}
            <p class="durl-hint" class:hint-violet={durlTag.color === 'violet'} class:hint-cyan={durlTag.color === 'cyan'} class:hint-amber={durlTag.color === 'amber'}>
              {durlTag.description}
            </p>
          {/if}
          {#if shardDurlWarning}
            <p class="durl-hint hint-warning">
              ⚠ {shardDurlWarning}
            </p>
          {/if}
        </div>
      </div>
      
      <div class="config-field">
        <label class="config-label">Description</label>
        <textarea
          bind:value={indexDescription}
          placeholder="Describe your application..."
          rows="2"
          disabled={deploying}
          class="config-textarea"
        ></textarea>
      </div>
      
      <div class="config-field">
        <label class="config-label">Icon URL (optional)</label>
        <div class="icon-input-wrapper">
          <input
            type="text"
            bind:value={indexIcon}
            placeholder="Icon DOC SCID (recommended) or URL"
            disabled={deploying}
            class="config-input"
            class:input-valid={indexIcon && iconValidation.valid && !iconValidation.warning}
            class:input-warning={iconValidation.warning}
            class:input-error={indexIcon && !iconValidation.valid}
          />
          {#if indexIcon}
            <span class="icon-status" class:valid={iconValidation.valid && !iconValidation.warning} class:warning={iconValidation.warning} class:invalid={!iconValidation.valid}>
              {#if iconValidation.valid && !iconValidation.warning}
                ✓
              {:else if iconValidation.warning}
                ⚠
              {:else}
                ✗
              {/if}
            </span>
          {/if}
        </div>
        {#if indexIcon && iconValidation.message}
          <p class="icon-hint" class:hint-valid={iconValidation.valid && !iconValidation.warning} class:hint-warning={iconValidation.warning} class:hint-error={!iconValidation.valid}>
            {iconValidation.message}
          </p>
        {:else}
          <p class="icon-hint">Recommended: use an on-chain icon DOC SCID (100x100 SVG/PNG works well).</p>
        {/if}
      </div>
      
      <!-- Ringsize Selector -->
      <div class="config-field">
        <label class="config-label">Content Type</label>
        <div class="ringsize-selector">
          <button
            type="button"
            class="ringsize-btn {ringsize === 2 ? 'active' : ''}"
            on:click={() => ringsize = 2}
            disabled={deploying}
          >
            <span class="ringsize-icon">↻</span>
            <span class="ringsize-label">Updateable</span>
            <span class="ringsize-desc">Ring 2 • Can be modified later</span>
          </button>
          <button
            type="button"
            class="ringsize-btn {ringsize === 16 ? 'active immutable' : ''}"
            class:disabled={enableMods}
            on:click={() => !enableMods && (ringsize = 16)}
            disabled={deploying || enableMods}
            title={enableMods ? 'MODs require updateable INDEX (Ring 2)' : ''}
          >
            <span class="ringsize-icon">◆</span>
            <span class="ringsize-label">Immutable</span>
            <span class="ringsize-desc">{enableMods ? 'Disabled when MODs enabled' : 'Ring 16 • Permanent, cannot change'}</span>
          </button>
        </div>
      </div>
      
      <!-- Compression Toggle (matching tela-cli) -->
      {#if hasCompressibleFiles()}
        <div class="config-field">
          <label class="config-label">Compression</label>
          <button 
            type="button"
            class="compression-toggle {enableCompression ? 'active' : ''}"
            on:click={() => enableCompression = !enableCompression}
            disabled={deploying}
          >
            <div class="compression-track">
              <div class="compression-thumb"></div>
            </div>
            <div class="compression-content">
              <span class="compression-label">{enableCompression ? 'Enabled' : 'Disabled'}</span>
              <span class="compression-desc">
                {enableCompression 
                  ? 'Text files will be gzip compressed (smaller on-chain size)' 
                  : 'Files stored uncompressed'}
              </span>
            </div>
          </button>
          {#if enableCompression}
            <p class="compression-note">
              ◈ HTML, CSS, JS, JSON, MD, and Go files will be gzip compressed before deployment
            </p>
          {/if}
        </div>
      {/if}
      
      <!-- Auto-Shard Toggle -->
      {#if preflightStats.hasOversized || enableAutoShard}
        <div class="config-field">
          <label class="config-label">Auto-Shard</label>
          <button
            type="button"
            class="autoshard-toggle {enableAutoShard ? 'active' : ''}"
            on:click={() => { enableAutoShard = !enableAutoShard; if (folderPath) scanFolder(); }}
            disabled={deploying}
          >
            <div class="autoshard-track">
              <div class="autoshard-thumb"></div>
            </div>
            <div class="autoshard-content">
              <span class="autoshard-label">{enableAutoShard ? 'Enabled' : 'Disabled'}</span>
              <span class="autoshard-desc">
                {enableAutoShard
                  ? 'Oversized files will be automatically split into shard DOCs'
                  : 'Files over 18KB will block deployment'}
              </span>
            </div>
          </button>
          {#if enableAutoShard}
            <p class="autoshard-note">
              ◈ Files larger than 18KB will be split in-memory before deployment — no temp files written to disk
            </p>
          {/if}
        </div>
      {/if}
      
      <!-- TELA-MODs Section (matching tela-cli modsPrompt) -->
      <div class="config-field mods-section">
        <div class="mods-header">
          <label class="config-label">
            <span class="mods-icon">⬡</span>
            TELA-MODs
          </label>
          <button 
            type="button"
            class="mods-toggle {enableMods ? 'active' : ''}"
            on:click={() => enableMods = !enableMods}
            disabled={deploying}
          >
            <div class="mods-toggle-track">
              <div class="mods-toggle-thumb"></div>
            </div>
            <span class="mods-toggle-label">{enableMods ? 'Enabled' : 'Disabled'}</span>
          </button>
        </div>
        
        {#if enableMods}
          <div class="mods-content">
            {#if modsLoading}
              <div class="mods-loading">
                <div class="mods-spinner"></div>
                <span>Loading MODs...</span>
              </div>
            {:else}
              <p class="mods-description">
                MODs add smart contract functionality to your INDEX. MODs require Ring 2 (updateable).
              </p>
              
              <!-- Variable Store MOD (single selection) -->
              <div class="mod-group">
                <label class="mod-group-label">
                  <span class="mod-icon">◈</span>
                  Variable Store
                  <span class="mod-group-hint">(select one)</span>
                </label>
                <div class="mod-options">
                  <button 
                    type="button"
                    class="mod-option {selectedVsMod === '' ? 'selected' : ''}"
                    on:click={() => selectedVsMod = ''}
                    disabled={deploying}
                  >
                    <span class="mod-option-name">None</span>
                  </button>
                  {#each getVsModOptions() as mod}
                    <button 
                      type="button"
                      class="mod-option {selectedVsMod === mod.tag ? 'selected' : ''}"
                      on:click={() => selectedVsMod = mod.tag}
                      disabled={deploying}
                      title={mod.description}
                    >
                      <span class="mod-option-tag">{mod.tag}</span>
                      <span class="mod-option-name">{mod.name?.replace('Variable store ', '') || mod.tag}</span>
                    </button>
                  {/each}
                </div>
              </div>
              
              <!-- Transfer MODs (multi-selection) -->
              <div class="mod-group">
                <label class="mod-group-label">
                  <span class="mod-icon">◆</span>
                  Transfers
                  <span class="mod-group-hint">(select multiple)</span>
                </label>
                <div class="mod-options">
                  {#each getTxModOptions() as mod}
                    <button 
                      type="button"
                      class="mod-option {selectedTxMods.includes(mod.tag) ? 'selected' : ''}"
                      on:click={() => toggleTxMod(mod.tag)}
                      disabled={deploying}
                      title={mod.description}
                    >
                      <span class="mod-option-tag">{mod.tag}</span>
                      <span class="mod-option-name">{mod.name || mod.tag}</span>
                      {#if selectedTxMods.includes(mod.tag)}
                        <span class="mod-check">✓</span>
                      {/if}
                    </button>
                  {/each}
                </div>
              </div>
              
              <!-- Selected MODs summary -->
              {#if getModTags()}
                <div class="mods-summary">
                  <span class="mods-summary-label">Selected:</span>
                  <code class="mods-summary-tags">{getModTags()}</code>
                </div>
              {/if}
            {/if}
          </div>
        {:else}
          <p class="mods-hint">
            Enable to add smart contract functionality (variable stores, deposits, transfers)
          </p>
        {/if}
      </div>
    </div>
    
    <!-- Deploy Button -->
    <div class="deploy-row">
      <div class="deploy-cost">
        {#if isSimulator}
          <span class="simulator-badge">SIMULATOR</span>
          <span class="free-badge">FREE</span>
        {:else}
          Rough estimated cost: <span class="cost-value">~{totalGas.toLocaleString()} gas</span>
        {/if}
      </div>
      
      <button
        bind:this={deployButtonEl}
        on:click={prepareDeploy}
        disabled={deploying || (!$walletState.isOpen && !isSimulator) || !indexName}
        class="btn-deploy"
      >
        {#if deploying}
          <div class="btn-spinner"></div>
          Deploying... ({deployProgress.current}/{deployProgress.total})
        {:else}
          Deploy {enableAutoShard && preflightExpansion ? (preflightExpansion.summary.deployDocCount ?? files.length) : files.length} Files + INDEX
        {/if}
      </button>
    </div>
    
    {#if !$walletState.isOpen && !isSimulator && !deploying}
      <p class="wallet-warning">
        <span class="warn-icon">!</span> Please open a wallet to deploy
      </p>
    {/if}
    
    <!-- Deployment Success Display -->
    {#if deploymentResult}
      <div class="success-card">
        <div class="success-header">
          <span class="success-icon">✓</span>
          <h3 class="success-title">Deployment Complete!</h3>
        </div>
        
        <div class="result-section">
          <div class="result-label">INDEX SCID</div>
          <div class="result-scid-row">
            <code class="result-scid">{deploymentResult.indexScid}</code>
            <button class="btn-icon-action" on:click={() => copyScid(deploymentResult.indexScid, 'INDEX SCID')} title="Copy full SCID">
              <Copy size={14} />
            </button>
            <button class="btn-icon-action" on:click={() => previewIndex(deploymentResult.indexScid)} title="Preview in Browser">
              <Eye size={14} />
            </button>
          </div>
        </div>
        
        {#if deploymentResult.durl}
          <div class="result-section">
            <div class="result-label">dURL</div>
            <code class="result-durl">{deploymentResult.durl}</code>
          </div>
        {/if}
        
        <div class="result-section">
          <div class="result-label">Deployed DOCs ({deploymentResult.deployedDocs?.length || 0})</div>
          <div class="deployed-docs-list">
            {#each (deploymentResult.deployedDocs || []) as doc}
              <div class="deployed-doc-row">
                <span class="deployed-doc-name">{doc.name}</span>
                <code class="deployed-doc-scid" title={doc.scid}>{doc.scid?.substring(0, 32)}...</code>
                <button class="btn-copy-sm" on:click={() => copyScid(doc.scid, doc.name)} title="Copy full SCID">
                  <Copy size={12} />
                </button>
              </div>
            {/each}
          </div>
        </div>
        
        <div class="success-actions">
          <button class="btn-reset" on:click={resetDeployment}>
            Deploy Another Batch
          </button>
          <button class="btn-copy-index" on:click={prepareDeploy} title="Deploy same folder and settings again">
            <Clock size={14} />
            Re-Deploy Same Config
          </button>
          <button bind:this={successPrimaryActionEl} class="btn-copy-index" on:click={() => copyScid(deploymentResult.indexScid, 'INDEX SCID')} title="Copy INDEX SCID">
            <Copy size={14} />
            Copy INDEX SCID
          </button>
          {#if deploymentResult.durl}
            <button class="btn-copy-index" on:click={() => copyText(deploymentResult.durl, 'dURL')} title="Copy dURL">
              <Copy size={14} />
              Copy dURL
            </button>
          {/if}
          <button class="btn-copy-index" on:click={copyAllDocScids} title="Copy all DOC SCIDs">
            <Copy size={14} />
            Copy all DOC SCIDs
          </button>
          {#if deploymentResult.durl}
            <button class="btn-preview-index" on:click={() => previewIndex(deploymentResult.indexScid)} title="Preview in Browser">
              <Eye size={14} />
              Preview in Browser
            </button>
          {/if}
        </div>
      </div>
    {/if}
  {:else}
    <div class="empty-state">
      <span class="empty-icon">◇</span>
      <p class="empty-text">No files found in folder</p>
    </div>
  {/if}
</div>

<!-- Confirmation Modal for Mainnet Deployment -->
{#if showConfirmModal}
  <div class="modal-overlay" on:click={cancelDeploy}>
    <div class="modal-content" on:click|stopPropagation>

      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-icon warning">
            <AlertTriangle size={18} strokeWidth={1.5} />
          </div>
          <div>
            <h3 class="modal-title">Confirm Deployment</h3>
            <p class="modal-subtitle">This action is permanent and cannot be undone</p>
          </div>
        </div>
        <button class="modal-close" on:click={cancelDeploy} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div class="modal-body">
        <p class="deploy-warn-text">
          You are deploying to <strong>Mainnet</strong>. The transaction is <strong>permanent</strong> and will consume DERO.
        </p>

        <div class="confirm-details">
          <div class="confirm-row">
            <span class="confirm-label">Files</span>
            <span class="confirm-value">{files.length} DOCs + 1 INDEX</span>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">Total Size</span>
            <span class="confirm-value">{formatSize(totalSize)}</span>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">Rough Gas Estimate</span>
            <span class="confirm-value confirm-value-amount">~{totalGas.toLocaleString()}</span>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">Type</span>
            <span class="confirm-value">{ringsize === 2 ? 'Updateable (Ring 2)' : 'Immutable (Ring 16)'}</span>
          </div>
        </div>
        <p class="deploy-warn-text" style="margin-top:8px; opacity:0.85;">
          Final fees are recalculated during mainnet precheck and may be higher than this rough estimate.
        </p>
      </div>

      <div class="modal-footer">
        <button class="modal-btn modal-btn-secondary" on:click={cancelDeploy}>Cancel</button>
        <button class="modal-btn modal-btn-primary" on:click={confirmDeploy}>Deploy to Mainnet</button>
      </div>

    </div>
  </div>
{/if}

<style>
  /* === HOLOGRAM v6.1 Batch Upload === */
  
  .batch-upload {
    display: flex;
    flex-direction: column;
    gap: var(--s-6, 24px);
  }

  .keyboard-quick-nav {
    display: flex;
    gap: var(--s-2, 8px);
    flex-wrap: wrap;
  }

  .quick-nav-btn {
    padding: 4px 10px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-3, #707088);
    font-size: 11px;
    cursor: pointer;
    transition: all 160ms ease;
  }

  .quick-nav-btn:hover {
    color: var(--cyan-400, #22d3ee);
    border-color: rgba(34, 211, 238, 0.35);
    background: rgba(34, 211, 238, 0.08);
  }

  .quick-nav-btn:focus-visible {
    outline: 2px solid var(--cyan-400, #22d3ee);
    outline-offset: 2px;
    color: var(--cyan-400, #22d3ee);
    border-color: rgba(34, 211, 238, 0.35);
    background: rgba(34, 211, 238, 0.08);
  }
  
  /* Folder Info */
  .folder-info {
    padding: var(--s-4, 16px);
    background: var(--void-deep, #08080e);
    border-radius: var(--r-lg, 12px);
  }
  
  .folder-info-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  
  .folder-label {
    font-size: 13px;
    color: var(--text-3, #707088);
  }
  
  .folder-path {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 13px;
    color: var(--text-2, #a8a8b8);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .btn-rescan {
    padding: var(--s-2, 8px) var(--s-3, 12px);
    background: var(--void-up, #181824);
    color: var(--text-3, #707088);
    border-radius: var(--r-md, 8px);
    border: none;
    font-size: 13px;
    cursor: pointer;
    transition: all 200ms ease-out;
  }
  
  .btn-rescan:hover {
    background: var(--void-surface, #1e1e2a);
    color: var(--text-2, #a8a8b8);
  }
  
  .btn-rescan:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  /* Alert Error */
  .alert-error {
    padding: var(--s-4, 16px);
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.3);
    border-radius: var(--r-lg, 12px);
    color: var(--status-err, #f87171);
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
  }
  
  .alert-icon {
    font-weight: 700;
  }
  
  /* Detailed Error Display */
  .error-details {
    margin-top: var(--s-3, 12px);
    padding: var(--s-4, 16px);
    background: var(--void-deep, #0a0a12);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    border-radius: var(--r-md, 8px);
  }
  
  .error-file {
    font-size: 12px;
    color: var(--text-3, #707088);
    margin-bottom: var(--s-3, 12px);
  }
  
  .error-file code {
    color: var(--cyan-400, #22d3ee);
    background: rgba(34, 211, 238, 0.1);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
  }
  
  .error-section {
    margin-bottom: var(--s-3, 12px);
  }
  
  .error-section:last-of-type {
    margin-bottom: var(--s-4, 16px);
  }
  
  .error-section-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-4, #505068);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: var(--s-1, 4px);
  }
  
  .error-section-content {
    font-size: 13px;
    color: var(--text-2, #a0a0b8);
    line-height: 1.5;
  }
  
  .error-example {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 12px;
    background: var(--void-pure, #000000);
    color: var(--emerald-400, #34d399);
    padding: var(--s-3, 12px);
    border-radius: var(--r-sm, 4px);
    overflow-x: auto;
    white-space: pre-wrap;
    margin: 0;
  }
  
  .error-dismiss {
    font-size: 12px;
    color: var(--text-4, #505068);
    background: transparent;
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    padding: var(--s-2, 8px) var(--s-3, 12px);
    border-radius: var(--r-sm, 4px);
    cursor: pointer;
    transition: all 0.15s ease;
    margin-right: var(--s-2, 8px);
  }
  
  .error-dismiss:hover {
    color: var(--text-2, #a0a0b8);
    border-color: var(--border-default, rgba(255, 255, 255, 0.09));
  }
  
  /* Loading State */
  .loading-state {
    text-align: center;
    padding: var(--s-8, 32px);
  }
  
  .spinner {
    width: 32px;
    height: 32px;
    border: 2px solid var(--cyan-500, #06b6d4);
    border-top-color: transparent;
    border-radius: var(--r-full, 9999px);
    animation: spin 0.6s linear infinite;
    margin: 0 auto var(--s-2, 8px);
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  .loading-text {
    color: var(--text-4, #505068);
  }
  
  /* Files Container */
  .files-container {
    border: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    border-radius: var(--r-lg, 12px);
    overflow: hidden;
  }
  
  .files-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-2, 8px) var(--s-4, 16px);
    background: var(--void-mid, #12121c);
    border-bottom: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
  }
  
  .files-count {
    font-size: 13px;
    color: var(--text-3, #707088);
  }
  
  .files-gas {
    font-size: 13px;
    color: var(--cyan-400, #22d3ee);
  }
  
  .files-free-badge {
    font-size: 10px;
    font-weight: 600;
    color: var(--emerald-400, #34d399);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    padding: 2px 6px;
    background: rgba(52, 211, 153, 0.15);
    border-radius: var(--r-sm, 4px);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .files-list {
    max-height: 256px;
    overflow-y: auto;
  }
  
  /* File Row */
  .file-row {
    display: flex;
    align-items: center;
    gap: var(--s-3, 12px);
    padding: var(--s-3, 12px);
    border-bottom: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    transition: background 200ms ease-out;
  }
  
  .file-row:last-child {
    border-bottom: none;
  }
  
  .file-row:hover {
    background: rgba(18, 18, 28, 0.5);
  }
  
  .file-row.highlight-deploying {
    background: rgba(251, 191, 36, 0.05);
  }
  
  .file-row.highlight-completed {
    background: rgba(52, 211, 153, 0.05);
  }
  
  .file-icon {
    font-size: 16px;
    color: var(--text-3, #707088);
    width: 24px;
    text-align: center;
  }
  
  .file-icon.status-pending {
    color: var(--text-5, #404058);
  }
  
  .file-icon.status-deploying {
    color: var(--status-warn, #fbbf24);
  }
  
  .file-icon.status-completed {
    color: var(--status-ok, #34d399);
  }
  
  .file-icon.status-failed {
    color: var(--status-err, #f87171);
  }
  
  .file-icon.status-waiting {
    color: var(--status-info, #60a5fa);
  }
  
  .file-icon.status-verifying {
    color: var(--accent-cyan, #22d3ee);
  }
  
  .file-icon.status-warning {
    color: var(--status-warn, #fbbf24);
  }
  
  .file-info {
    flex: 1;
    min-width: 0;
  }
  
  .file-name-row {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
  }
  
  .file-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2, #a8a8b8);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  /* #3: Entry Point Badge - improved with icon and tooltip */
  .badge-entry {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 600;
    background: rgba(6, 182, 212, 0.15);
    border: 1px solid rgba(6, 182, 212, 0.3);
    color: var(--cyan-400, #22d3ee);
    border-radius: var(--r-xs, 3px);
    cursor: help;
  }
  
  .entry-icon {
    font-size: 10px;
    opacity: 0.8;
  }
  
  .badge-deploying {
    padding: 2px 6px;
    font-size: 10px;
    background: rgba(251, 191, 36, 0.2);
    color: var(--status-warn, #fbbf24);
    border-radius: var(--r-xs, 3px);
    animation: pulse 1.5s ease-in-out infinite;
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  
  .file-meta {
    font-size: 12px;
    color: var(--text-5, #404058);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  /* File Type Select - HOLOGRAM Design System Compliant */
  .file-type-select {
    padding: var(--s-1, 4px) var(--s-2, 8px);
    padding-right: 28px; /* Room for dropdown arrow */
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 11px;
    color: var(--text-3, #707088);
    background: var(--void-deep, #08080e);
    /* Custom dropdown arrow - HOLOGRAM standard */
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23707088' d='M2 4l4 4 4-4'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 6px center;
    border: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    border-radius: var(--r-sm, 5px);
    /* CRITICAL: Remove native OS styling */
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    cursor: pointer;
    outline: none;
    transition: all 150ms ease;
  }
  
  .file-type-select:hover {
    border-color: var(--border-subtle, rgba(255, 255, 255, 0.06));
  }
  
  .file-type-select:focus {
    border-color: var(--cyan-500, #06b6d4);
    box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.15);
  }
  
  .file-type-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background-color: var(--void-mid, #12121c);
  }
  
  .file-type-select option {
    background: var(--void-deep, #08080e);
    color: var(--text-1, #f8f8fc);
  }
  
  /* File Type Wrapper - shows badge + dropdown */
  .file-type-wrapper {
    display: flex;
    align-items: center;
    gap: var(--s-1, 4px);
  }
  
  /* File Type Badge - color-coded by type */
  .file-type-badge {
    padding: 3px 8px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-radius: var(--r-xs, 3px);
    cursor: help;
    white-space: nowrap;
  }
  
  /* Type-specific colors */
  .file-type-badge.type-html {
    background: rgba(34, 211, 238, 0.15);
    border: 1px solid rgba(34, 211, 238, 0.3);
    color: var(--cyan-400, #22d3ee);
  }
  
  .file-type-badge.type-css {
    background: rgba(167, 139, 250, 0.15);
    border: 1px solid rgba(167, 139, 250, 0.3);
    color: var(--violet-400, #a78bfa);
  }
  
  .file-type-badge.type-js {
    background: rgba(251, 191, 36, 0.15);
    border: 1px solid rgba(251, 191, 36, 0.3);
    color: var(--status-warn, #fbbf24);
  }
  
  .file-type-badge.type-json {
    background: rgba(52, 211, 153, 0.12);
    border: 1px solid rgba(52, 211, 153, 0.25);
    color: var(--emerald-400, #34d399);
  }
  
  .file-type-badge.type-md {
    background: rgba(168, 168, 184, 0.1);
    border: 1px solid rgba(168, 168, 184, 0.2);
    color: var(--text-2, #a8a8b8);
  }
  
  .file-type-badge.type-go {
    background: rgba(34, 211, 238, 0.12);
    border: 1px solid rgba(34, 211, 238, 0.25);
    color: var(--cyan-300, #67e8f9);
  }
  
  .file-type-badge.type-static {
    background: rgba(80, 80, 104, 0.15);
    border: 1px solid rgba(80, 80, 104, 0.3);
    color: var(--text-4, #505068);
  }
  
  /* #2: Confident detection badge - subtle checkmark indicator */
  .file-type-badge.confident {
    position: relative;
    cursor: help;
  }
  
  .file-type-badge.confident::after {
    content: '✓';
    margin-left: 4px;
    font-size: 9px;
    opacity: 0.6;
  }
  
  /* #5: Compression eligibility badge */
  .compress-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    background: rgba(6, 182, 212, 0.12);
    border: 1px solid rgba(6, 182, 212, 0.25);
    border-radius: var(--r-xs, 3px);
    cursor: help;
  }
  
  .compress-icon {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 10px;
    font-weight: 700;
    color: var(--cyan-400, #22d3ee);
    line-height: 1;
  }
  
  .file-remove-btn {
    color: var(--text-5, #404058);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: var(--s-1, 4px);
    transition: color 200ms ease-out;
  }
  
  .file-remove-btn:hover {
    color: var(--status-err, #f87171);
  }
  
  .file-remove-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  
  /* Progress Card */
  .progress-card {
    padding: var(--s-5, 20px);
    background: var(--void-mid, #12121c);
    border: 1px solid rgba(6, 182, 212, 0.3);
    border-radius: var(--r-xl, 16px);
    position: sticky;
    top: var(--s-2, 8px);
    z-index: 2;
  }

  .progress-live-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2, 8px);
    margin-bottom: var(--s-2, 8px);
    padding: 4px 10px;
    background: rgba(34, 211, 238, 0.08);
    border: 1px solid rgba(34, 211, 238, 0.22);
    border-radius: 999px;
    font-size: 11px;
    color: var(--cyan-300, #67e8f9);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    line-height: 1.2;
  }

  .progress-chip-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--cyan-400, #22d3ee);
    box-shadow: 0 0 8px rgba(34, 211, 238, 0.8);
    animation: pulse 1.4s ease-in-out infinite;
  }

  .progress-chip-network {
    color: var(--text-3, #707088);
    padding-left: 8px;
    margin-left: 2px;
    border-left: 1px solid rgba(255, 255, 255, 0.2);
  }

  .progress-steps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 6px;
    margin-bottom: var(--s-2, 8px);
  }

  .progress-step {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 6px;
    font-size: 10px;
    color: var(--text-4, #505068);
    background: rgba(255, 255, 255, 0.04);
    min-width: 0;
  }

  .step-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentColor;
    opacity: 0.9;
  }

  .progress-step span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .progress-step.active {
    color: var(--cyan-300, #67e8f9);
    background: rgba(34, 211, 238, 0.08);
  }

  .progress-step.done {
    color: var(--status-ok, #34d399);
    background: rgba(52, 211, 153, 0.1);
  }

  .progress-step.error {
    color: var(--status-err, #f87171);
    background: rgba(248, 113, 113, 0.12);
  }
  
  .progress-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--s-2, 8px);
  }
  
  .progress-status {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2, #a8a8b8);
  }
  
  .progress-count {
    font-size: 13px;
    color: var(--cyan-400, #22d3ee);
  }
  
  .progress-bar-bg {
    width: 100%;
    height: 12px;
    background: var(--void-deep, #08080e);
    border-radius: var(--r-full, 9999px);
    overflow: hidden;
  }
  
  .progress-bar-fill {
    height: 100%;
    background: var(--cyan-500, #06b6d4);
    border-radius: var(--r-full, 9999px);
    transition: width 300ms ease-out;
  }
  
  .progress-note {
    font-size: 12px;
    text-align: center;
    margin-top: var(--s-2, 8px);
  }
  
  .progress-note.success {
    color: var(--status-ok, #34d399);
  }

  .progress-note.info {
    color: var(--cyan-400, #22d3ee);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
  }

  .progress-note.hint {
    color: var(--text-4, #505068);
    margin-top: var(--s-1, 4px);
    font-size: 11px;
  }
  
  /* Config Card */
  .config-card {
    padding: var(--s-5, 20px);
    background: var(--void-mid, #12121c);
    border: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    border-radius: var(--r-xl, 16px);
    display: flex;
    flex-direction: column;
    gap: var(--s-4, 16px);
  }
  
  .config-card.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  
  .config-title {
    font-weight: 500;
    color: var(--text-2, #a8a8b8);
  }
  
  .config-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-4, 16px);
  }
  
  .config-field {
    display: flex;
    flex-direction: column;
    gap: var(--s-1, 4px);
  }
  
  .config-label {
    font-size: 13px;
    color: var(--text-4, #505068);
  }
  
  .config-input,
  .config-textarea {
    width: 100%;
    padding: var(--s-2, 8px) var(--s-3, 12px);
    background: var(--void-deep, #08080e);
    border: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    border-radius: var(--r-lg, 12px);
    color: var(--text-1, #f8f8fc);
    font-size: 13px;
    outline: none;
    transition: border-color 200ms ease-out;
  }
  
  .config-input::placeholder,
  .config-textarea::placeholder {
    color: var(--text-5, #404058);
  }
  
  .config-input:focus,
  .config-textarea:focus {
    border-color: var(--cyan-500, #06b6d4);
  }
  
  .config-input:disabled,
  .config-textarea:disabled {
    opacity: 0.5;
  }
  
  .config-textarea {
    resize: none;
  }
  
  /* Deploy Row */
  .deploy-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  
  .deploy-cost {
    font-size: 13px;
    color: var(--text-4, #505068);
  }
  
  .cost-value {
    color: var(--cyan-400, #22d3ee);
    font-weight: 500;
  }
  
  .btn-deploy {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
    padding: var(--s-3, 12px) var(--s-6, 24px);
    background: var(--cyan-500, #06b6d4);
    color: var(--void-pure, #000000);
    border-radius: var(--r-lg, 12px);
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: background 200ms ease-out;
  }
  
  .btn-deploy:hover {
    background: var(--cyan-400, #22d3ee);
  }
  
  .btn-deploy:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .btn-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--void-pure, #000000);
    border-top-color: transparent;
    border-radius: var(--r-full, 9999px);
    animation: spin 0.6s linear infinite;
  }
  
  /* Wallet Warning */
  .wallet-warning {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2, 8px);
    font-size: 13px;
    color: var(--status-warn, #fbbf24);
    text-align: center;
  }
  
  .warn-icon {
    font-weight: 700;
  }
  
  /* Empty State */
  .empty-state {
    text-align: center;
    padding: var(--s-8, 32px);
    color: var(--text-4, #505068);
  }
  
  .empty-icon {
    font-size: 40px;
    display: block;
    margin-bottom: var(--s-2, 8px);
  }
  
  .empty-text {
    font-size: 13px;
  }
  
  /* SubDir Input */
  .subdir-input {
    width: 80px;
    padding: 2px 6px;
    font-size: 11px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    background: var(--void-deep, #08080e);
    border: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    border-radius: var(--r-xs, 3px);
    color: var(--text-3, #707088);
    outline: none;
  }
  
  .subdir-input:focus {
    border-color: var(--cyan-500, #06b6d4);
  }
  
  .subdir-display {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    color: var(--text-4, #505068);
  }
  
  .file-size {
    color: var(--text-4, #505068);
  }
  
  .file-meta {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
  }
  
  /* Required field indicator */
  .required {
    color: var(--status-err, #f87171);
  }
  
  /* Ringsize Selector */
  .ringsize-selector {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-3, 12px);
  }
  
  .ringsize-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--s-4, 16px);
    background: var(--void-deep, #08080e);
    border: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    border-radius: var(--r-lg, 12px);
    cursor: pointer;
    transition: all 200ms ease-out;
  }
  
  .ringsize-btn:hover {
    border-color: var(--border-subtle, rgba(255, 255, 255, 0.06));
    background: var(--void-up, #181824);
  }
  
  .ringsize-btn.active {
    border-color: var(--cyan-500, #06b6d4);
    background: rgba(6, 182, 212, 0.1);
  }
  
  .ringsize-btn.active.immutable {
    border-color: var(--violet-400, #a78bfa);
    background: rgba(167, 139, 250, 0.1);
  }
  
  .ringsize-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .ringsize-icon {
    font-size: 20px;
    margin-bottom: var(--s-1, 4px);
    color: var(--text-3, #707088);
  }
  
  .ringsize-btn.active .ringsize-icon {
    color: var(--cyan-400, #22d3ee);
  }
  
  .ringsize-btn.active.immutable .ringsize-icon {
    color: var(--violet-400, #a78bfa);
  }
  
  .ringsize-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2, #a8a8b8);
  }
  
  .ringsize-desc {
    font-size: 11px;
    color: var(--text-5, #404058);
    text-align: center;
  }
  
  /* Compression Toggle (matching tela-cli) */
  .compression-toggle {
    display: flex;
    align-items: center;
    gap: var(--s-3, 12px);
    width: 100%;
    padding: var(--s-3, 12px) var(--s-4, 16px);
    background: var(--void-deep, #08080e);
    border: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    border-radius: var(--r-lg, 12px);
    cursor: pointer;
    transition: all 200ms ease-out;
    text-align: left;
  }
  
  .compression-toggle:hover {
    border-color: var(--border-subtle, rgba(255, 255, 255, 0.06));
    background: var(--void-up, #181824);
  }
  
  .compression-toggle.active {
    border-color: var(--cyan-500, #06b6d4);
    background: rgba(6, 182, 212, 0.08);
  }
  
  .compression-toggle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .compression-track {
    width: 36px;
    height: 20px;
    background: var(--void-surface, #1e1e2a);
    border-radius: 10px;
    position: relative;
    transition: background 200ms ease-out;
    flex-shrink: 0;
  }
  
  .compression-toggle.active .compression-track {
    background: var(--cyan-500, #06b6d4);
  }
  
  .compression-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: var(--text-4, #505068);
    border-radius: 50%;
    transition: all 200ms ease-out;
  }
  
  .compression-toggle.active .compression-thumb {
    left: 18px;
    background: #fff;
  }
  
  .compression-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  
  .compression-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2, #a8a8b8);
  }
  
  .compression-toggle.active .compression-label {
    color: var(--cyan-400, #22d3ee);
  }
  
  .compression-desc {
    font-size: 11px;
    color: var(--text-4, #505068);
  }
  
  .compression-note {
    margin-top: var(--s-2, 8px);
    padding: var(--s-2, 8px) var(--s-3, 12px);
    background: rgba(6, 182, 212, 0.05);
    border-radius: var(--r-md, 8px);
    font-size: 11px;
    color: var(--cyan-400, #22d3ee);
  }

  /* Auto-Shard Toggle */
  .autoshard-toggle {
    display: flex;
    align-items: center;
    gap: var(--s-3, 12px);
    width: 100%;
    padding: var(--s-3, 12px) var(--s-4, 16px);
    background: var(--void-deep, #08080e);
    border: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    border-radius: var(--r-lg, 12px);
    cursor: pointer;
    transition: all 200ms ease-out;
    text-align: left;
  }

  .autoshard-toggle:hover {
    border-color: var(--border-subtle, rgba(255, 255, 255, 0.06));
    background: var(--void-up, #181824);
  }

  .autoshard-toggle.active {
    border-color: var(--violet-500, #8b5cf6);
    background: rgba(139, 92, 246, 0.08);
  }

  .autoshard-toggle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .autoshard-track {
    width: 36px;
    height: 20px;
    background: var(--void-surface, #1e1e2a);
    border-radius: 10px;
    position: relative;
    transition: background 200ms ease-out;
    flex-shrink: 0;
  }

  .autoshard-toggle.active .autoshard-track {
    background: var(--violet-500, #8b5cf6);
  }

  .autoshard-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: var(--text-4, #505068);
    border-radius: 50%;
    transition: all 200ms ease-out;
  }

  .autoshard-toggle.active .autoshard-thumb {
    left: 18px;
    background: #fff;
  }

  .autoshard-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .autoshard-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2, #a8a8b8);
  }

  .autoshard-toggle.active .autoshard-label {
    color: var(--violet-400, #a78bfa);
  }

  .autoshard-desc {
    font-size: 11px;
    color: var(--text-4, #505068);
  }

  .autoshard-note {
    margin-top: var(--s-2, 8px);
    padding: var(--s-2, 8px) var(--s-3, 12px);
    background: rgba(139, 92, 246, 0.05);
    border-radius: var(--r-md, 8px);
    font-size: 11px;
    color: var(--violet-400, #a78bfa);
  }

  .preflight-shard-callout {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2, 8px);
    padding: var(--s-2, 8px) var(--s-3, 12px);
    background: rgba(139, 92, 246, 0.06);
    border: 1px solid rgba(139, 92, 246, 0.2);
    border-radius: var(--r-md, 8px);
    font-size: 12px;
    color: var(--violet-400, #a78bfa);
    margin-top: var(--s-2, 8px);
  }

  .btn-enable-autoshard {
    margin-left: auto;
    flex-shrink: 0;
    padding: 5px 10px;
    border-radius: var(--r-sm, 5px);
    border: 1px solid rgba(139, 92, 246, 0.35);
    background: rgba(139, 92, 246, 0.12);
    color: var(--violet-300, #c4b5fd);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 160ms ease;
  }

  .btn-enable-autoshard:hover {
    background: rgba(139, 92, 246, 0.22);
    border-color: rgba(139, 92, 246, 0.55);
  }

  .btn-enable-autoshard:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .preflight-shard-icon {
    font-size: 14px;
    flex-shrink: 0;
    margin-top: 1px;
  }
  
  /* Simulator & Free Badges */
  .simulator-badge {
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
    background: rgba(251, 191, 36, 0.2);
    color: var(--status-warn, #fbbf24);
    border-radius: var(--r-sm, 5px);
    margin-right: var(--s-2, 8px);
  }
  
  .free-badge {
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
    background: rgba(52, 211, 153, 0.2);
    color: var(--status-ok, #34d399);
    border-radius: var(--r-sm, 5px);
  }
  
  /* Success Card */
  .success-card {
    padding: var(--s-5, 20px);
    background: var(--void-mid, #12121c);
    border: 1px solid rgba(52, 211, 153, 0.3);
    border-radius: var(--r-xl, 16px);
  }
  
  .success-header {
    display: flex;
    align-items: center;
    gap: var(--s-3, 12px);
    margin-bottom: var(--s-4, 16px);
  }
  
  .success-icon {
    font-size: 24px;
    color: var(--status-ok, #34d399);
  }
  
  .success-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-1, #f8f8fc);
  }
  
  .result-section {
    margin-bottom: var(--s-4, 16px);
  }
  
  .result-label {
    font-size: 12px;
    color: var(--text-3, #707088);
    font-weight: 600;
    margin-bottom: var(--s-1, 4px);
  }
  
  .result-scid-row {
    display: flex;
    align-items: stretch; /* Ensure all elements stretch to same height */
    gap: var(--s-2, 8px);
  }
  
  .result-scid {
    flex: 1;
    display: flex;
    align-items: center;
    height: 36px; /* Match button height */
    padding: 0 var(--s-3, 12px);
    background: var(--void-deep, #08080e);
    border-radius: var(--r-md, 8px);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 12px;
    color: var(--cyan-400, #22d3ee);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .result-durl {
    padding: var(--s-2, 8px) var(--s-3, 12px);
    background: var(--void-deep, #08080e);
    border-radius: var(--r-md, 8px);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 12px;
    color: var(--text-2, #a8a8b8);
  }
  
  /* Icon action buttons - matches SCID container height */
  .btn-icon-action {
    display: flex;
    align-items: center;
    justify-content: center;
    /* Match the .result-scid height (8px padding top/bottom + line-height) */
    height: 36px;
    width: 36px;
    padding: 0;
    background: var(--void-up, #181824);
    border: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    border-radius: var(--r-md, 8px);
    color: var(--text-3, #707088);
    cursor: pointer;
    transition: all 200ms ease-out;
    flex-shrink: 0;
  }
  
  .btn-icon-action:hover {
    background: var(--void-surface, #1e1e2a);
    border-color: var(--border-subtle, rgba(255, 255, 255, 0.06));
    color: var(--cyan-400, #22d3ee);
  }
  
  .btn-icon-action:active {
    background: var(--void-deep, #08080e);
  }
  
  .deployed-docs-list {
    max-height: 150px;
    overflow-y: auto;
    background: var(--void-deep, #08080e);
    border-radius: var(--r-md, 8px);
    padding: var(--s-2, 8px);
  }
  
  .deployed-doc-row {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
    padding: var(--s-1, 4px) var(--s-2, 8px);
    border-radius: var(--r-sm, 5px);
  }
  
  .deployed-doc-row:hover {
    background: rgba(18, 18, 28, 0.5);
  }
  
  .deployed-doc-name {
    flex: 1;
    font-size: 12px;
    color: var(--text-2, #a8a8b8);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .deployed-doc-scid {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 11px;
    color: var(--text-3, #707088);
  }
  
  .btn-copy-sm {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    background: transparent;
    border: none;
    color: var(--text-5, #404058);
    cursor: pointer;
    transition: all 200ms ease-out;
    border-radius: var(--r-xs, 3px);
  }
  
  .btn-copy-sm:hover {
    color: var(--cyan-400, #22d3ee);
    background: rgba(34, 211, 238, 0.1);
  }
  
  .success-actions {
    display: flex;
    gap: var(--s-2, 8px);
    margin-top: var(--s-4, 16px);
    flex-wrap: wrap;
  }
  
  .btn-reset {
    flex: 1 1 200px;
    min-width: 180px;
    padding: var(--s-3, 12px);
    background: var(--void-up, #181824);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    border-radius: var(--r-lg, 12px);
    color: var(--text-2, #a8a8b8);
    font-size: 13px;
    cursor: pointer;
    transition: all 200ms ease-out;
  }
  
  .btn-reset:hover {
    background: var(--void-surface, #1e1e2a);
    border-color: var(--cyan-500, #06b6d4);
    color: var(--cyan-400, #22d3ee);
  }
  
  .btn-copy-index,
  .btn-preview-index {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2, 8px);
    padding: var(--s-3, 12px) var(--s-4, 16px);
    background: var(--void-up, #181824);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    border-radius: var(--r-lg, 12px);
    color: var(--text-2, #a8a8b8);
    font-size: 13px;
    cursor: pointer;
    transition: all 200ms ease-out;
    white-space: nowrap;
  }

  @media (max-width: 1100px) {
    .progress-steps {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .progress-card {
      top: 0;
      padding: var(--s-4, 16px);
    }

    .progress-live-chip {
      display: flex;
      width: 100%;
      justify-content: space-between;
    }

    .progress-chip-network {
      padding-left: 6px;
      margin-left: auto;
    }

    .preflight-warning {
      flex-wrap: wrap;
    }

    .btn-enable-autoshard {
      margin-left: 22px;
    }

    .success-actions {
      flex-direction: column;
    }

    .btn-reset,
    .btn-copy-index,
    .btn-preview-index {
      width: 100%;
      justify-content: center;
    }
  }
  
  .btn-copy-index:hover,
  .btn-preview-index:hover {
    background: var(--void-surface, #1e1e2a);
    border-color: var(--cyan-500, #06b6d4);
    color: var(--cyan-400, #22d3ee);
  }

  /* Accessibility: keyboard focus parity with hover states */
  .btn-rescan:focus-visible,
  .file-remove-btn:focus-visible,
  .btn-enable-autoshard:focus-visible,
  .btn-deploy:focus-visible,
  .btn-icon-action:focus-visible,
  .btn-copy-sm:focus-visible,
  .btn-reset:focus-visible,
  .btn-copy-index:focus-visible,
  .btn-preview-index:focus-visible,
  .ringsize-btn:focus-visible,
  .compression-toggle:focus-visible,
  .autoshard-toggle:focus-visible,
  .mods-toggle:focus-visible,
  .mod-option:focus-visible,
  .error-dismiss:focus-visible {
    outline: 2px solid var(--cyan-400, #22d3ee);
    outline-offset: 2px;
  }

  .btn-rescan:focus-visible,
  .btn-icon-action:focus-visible,
  .btn-copy-sm:focus-visible,
  .btn-reset:focus-visible,
  .btn-copy-index:focus-visible,
  .btn-preview-index:focus-visible {
    background: var(--void-surface, #1e1e2a);
    border-color: var(--cyan-500, #06b6d4);
    color: var(--cyan-400, #22d3ee);
  }

  .btn-enable-autoshard:focus-visible {
    background: rgba(139, 92, 246, 0.22);
    border-color: rgba(139, 92, 246, 0.55);
    color: var(--violet-300, #c4b5fd);
  }

  .file-remove-btn:focus-visible {
    color: var(--status-err, #f87171);
  }
  
  /* Confirmation Modal — deploy warning body text */
  .deploy-warn-text {
    font-size: 13px;
    color: var(--text-3);
    line-height: 1.6;
    margin-bottom: var(--s-4);
  }

  .deploy-warn-text strong {
    color: var(--text-1);
  }
  
  /* === TELA-MODs Styles === */
  .mods-section {
    border-top: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    padding-top: var(--s-4, 16px);
  }
  
  .mods-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--s-2, 8px);
  }
  
  .mods-icon {
    color: var(--violet-400, #a78bfa);
    margin-right: var(--s-1, 4px);
  }
  
  .mods-toggle {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: var(--s-1, 4px);
  }
  
  .mods-toggle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .mods-toggle-track {
    width: 36px;
    height: 20px;
    background: var(--void-surface, #1e1e2a);
    border-radius: 10px;
    position: relative;
    transition: background 200ms ease-out;
  }
  
  .mods-toggle.active .mods-toggle-track {
    background: var(--violet-500, #8b5cf6);
  }
  
  .mods-toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: var(--text-4, #505068);
    border-radius: 50%;
    transition: all 200ms ease-out;
  }
  
  .mods-toggle.active .mods-toggle-thumb {
    left: 18px;
    background: #fff;
  }
  
  .mods-toggle-label {
    font-size: 12px;
    color: var(--text-4, #505068);
  }
  
  .mods-toggle.active .mods-toggle-label {
    color: var(--violet-400, #a78bfa);
  }
  
  .mods-content {
    background: var(--void-deep, #08080e);
    border-radius: var(--r-lg, 12px);
    padding: var(--s-3, 12px);
    display: flex;
    flex-direction: column;
    gap: var(--s-3, 12px);
  }
  
  .mods-loading {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
    justify-content: center;
    padding: var(--s-4, 16px);
    color: var(--text-4, #505068);
    font-size: 13px;
  }
  
  .mods-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--violet-500, #8b5cf6);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  
  .mods-description {
    font-size: 12px;
    color: var(--text-4, #505068);
    line-height: 1.5;
  }
  
  .mods-hint {
    font-size: 12px;
    color: var(--text-5, #404058);
    margin-top: var(--s-1, 4px);
  }
  
  .mod-group {
    display: flex;
    flex-direction: column;
    gap: var(--s-2, 8px);
  }
  
  .mod-group-label {
    font-size: 12px;
    color: var(--text-3, #707088);
    display: flex;
    align-items: center;
    gap: var(--s-1, 4px);
  }
  
  .mod-icon {
    color: var(--cyan-400, #22d3ee);
  }
  
  .mod-group-hint {
    font-size: 11px;
    color: var(--text-5, #404058);
    margin-left: auto;
  }
  
  .mod-options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1, 4px);
  }
  
  .mod-option {
    display: flex;
    align-items: center;
    gap: var(--s-1, 4px);
    padding: var(--s-1, 4px) var(--s-2, 8px);
    background: var(--void-up, #181824);
    border: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    border-radius: var(--r-sm, 5px);
    font-size: 11px;
    color: var(--text-3, #707088);
    cursor: pointer;
    transition: all 150ms ease-out;
  }
  
  .mod-option:hover {
    border-color: var(--border-subtle, rgba(255, 255, 255, 0.06));
    background: var(--void-surface, #1e1e2a);
  }
  
  .mod-option.selected {
    border-color: var(--violet-500, #8b5cf6);
    background: rgba(139, 92, 246, 0.15);
    color: var(--violet-400, #a78bfa);
  }
  
  .mod-option:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .mod-option-tag {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 10px;
    padding: 1px 4px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 3px;
    text-transform: uppercase;
  }
  
  .mod-option.selected .mod-option-tag {
    background: rgba(139, 92, 246, 0.3);
  }
  
  .mod-option-name {
    font-size: 11px;
  }
  
  .mod-check {
    color: var(--violet-400, #a78bfa);
    font-size: 10px;
    margin-left: var(--s-1, 4px);
  }
  
  .mods-summary {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
    padding: var(--s-2, 8px);
    background: rgba(139, 92, 246, 0.08);
    border-radius: var(--r-md, 8px);
    border: 1px solid rgba(139, 92, 246, 0.2);
  }
  
  .mods-summary-label {
    font-size: 12px;
    color: var(--text-4, #505068);
  }
  
  .mods-summary-tags {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 12px;
    color: var(--violet-400, #a78bfa);
  }
  
  /* Icon URL Validation Styles */
  .icon-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }
  
  .icon-input-wrapper .config-input {
    padding-right: 32px;
  }
  
  .icon-status {
    position: absolute;
    right: 12px;
    font-size: 12px;
    pointer-events: none;
  }
  
  .icon-status.valid {
    color: var(--status-ok, #34d399);
  }
  
  .icon-status.warning {
    color: var(--status-warn, #fbbf24);
  }
  
  .icon-status.invalid {
    color: var(--status-err, #f87171);
  }
  
  .config-input.input-valid {
    border-color: var(--status-ok, #34d399);
  }
  
  .config-input.input-warning {
    border-color: var(--status-warn, #fbbf24);
  }
  
  .config-input.input-error {
    border-color: var(--status-err, #f87171);
  }
  
  .icon-hint {
    font-size: 11px;
    margin-top: var(--s-1, 4px);
    color: var(--text-4, #505068);
  }
  
  .icon-hint.hint-valid {
    color: var(--status-ok, #34d399);
  }
  
  .icon-hint.hint-warning {
    color: var(--status-warn, #fbbf24);
  }
  
  .icon-hint.hint-error {
    color: var(--status-err, #f87171);
  }
  
  /* dURL Tag Detection Styles */
  .durl-tag-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 6px;
    margin-left: var(--s-1, 4px);
    font-size: 10px;
    font-weight: 500;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-3, #707088);
    vertical-align: middle;
  }
  
  .durl-tag-badge.tag-violet {
    background: rgba(139, 92, 246, 0.15);
    color: var(--violet-400, #a78bfa);
  }
  
  .durl-tag-badge.tag-cyan {
    background: rgba(6, 182, 212, 0.15);
    color: var(--cyan-400, #22d3ee);
  }
  
  .durl-tag-badge.tag-amber {
    background: rgba(251, 191, 36, 0.15);
    color: var(--status-warn, #fbbf24);
  }
  
  .tag-icon {
    font-size: 10px;
  }
  
  .durl-hint {
    font-size: 11px;
    margin-top: var(--s-1, 4px);
    color: var(--text-4, #505068);
  }
  
  .durl-hint.hint-violet {
    color: var(--violet-400, #a78bfa);
  }
  
  .durl-hint.hint-cyan {
    color: var(--cyan-400, #22d3ee);
  }
  
  .durl-hint.hint-amber {
    color: var(--status-warn, #fbbf24);
  }

  .durl-hint.hint-warning {
    color: var(--status-warn, #fbbf24);
  }

  /* Preflight Summary Panel */
  .preflight-summary {
    background: var(--surface-1, #14141a);
    border: 1px solid var(--border-1, #2a2a35);
    border-radius: var(--radius-2, 8px);
    padding: var(--s-3, 12px);
    margin-bottom: var(--s-3, 12px);
  }

  .preflight-stats {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-3, 12px);
    padding: var(--s-2, 8px) 0;
  }

  .preflight-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .preflight-stat-value {
    font-size: 20px;
    font-weight: 600;
    color: var(--cyan-400, #22d3ee);
  }

  .preflight-stat-label {
    font-size: 11px;
    color: var(--text-4, #505068);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .preflight-stat-arrow,
  .preflight-stat-plus {
    font-size: 16px;
    color: var(--text-4, #505068);
    opacity: 0.6;
  }

  .preflight-warning {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2, 8px);
    padding: var(--s-2, 8px) var(--s-3, 12px);
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.3);
    border-radius: var(--radius-1, 6px);
    margin-top: var(--s-3, 12px);
    color: var(--status-warn, #fbbf24);
    font-size: 12px;
    line-height: 1.4;
  }

  .preflight-warning :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
  }

  .preflight-hint {
    font-size: 11px;
    color: var(--text-3, #707088);
    margin-top: var(--s-2, 8px);
    padding: var(--s-2, 8px) var(--s-3, 12px);
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--r-md, 8px);
    line-height: 1.4;
  }
</style>

