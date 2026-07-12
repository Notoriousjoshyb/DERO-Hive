const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/joshu/Desktop/dero toolbox/DERO-Hive/';

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function write(rel, content) { fs.writeFileSync(path.join(ROOT, rel), content, 'utf8'); }

let log = [];
function apply(rel, oldText, newText) {
  const s = read(rel);
  if (!s.includes(oldText)) {
    log.push(`MISS  ${rel}: ${oldText.slice(0, 60)}...`);
    return;
  }
  if (s.includes(newText)) {
    log.push(`SKIP  ${rel}`);
    return;
  }
  write(rel, s.replace(oldText, newText));
  log.push(`OK    ${rel}`);
}

// 1. index.ts — add imports and instantiate + register
{
  const f = 'src/main/index.ts';
  let s = read(f);

  s = s.replace(
    "import { registerKnowledgeHandlers } from './ipc/knowledge';\nimport { initDb, closeDb, getSetting } from './db/client';",
    "import { registerKnowledgeHandlers } from './ipc/knowledge';\nimport { registerMediaHandlers } from './ipc/media';\nimport { MediaManager } from './media/manager';\nimport { initDb, closeDb, getSetting } from './db/client';"
  );

  // Add MediaManager after simulatorManager declaration
  s = s.replace(
    'let simulatorManager: SimulatorManager | null = null;',
    'let simulatorManager: SimulatorManager | null = null;\nlet mediaManager: MediaManager | null = null;'
  );

  // Instantiate MediaManager right after simulator manager init — before
  // registerKnowledgeHandlers line
  s = s.replace(
    /simulatorManager = new SimulatorManager\(\(status\) => \{[\s\S]*?\}\);\n/,
    `$&  mediaManager = new MediaManager();\n`
  );

  // Register handlers after knowledge handlers
  s = s.replace(
    'registerKnowledgeHandlers(knowledgeService, knowledgeAutomations);',
    `registerKnowledgeHandlers(knowledgeService, knowledgeAutomations);\n  if (mediaManager) registerMediaHandlers(mediaManager, () => mainWindow);`
  );

  write(f, s);
  log.push('OK index.ts');
}

// 2. preload/index.ts — add media API
{
  const f = 'src/preload/index.ts';
  let s = read(f);

  const apiAppend = `
  // Media (image + video generation)
  mediaList: () => ipcRenderer.invoke(IPC.MEDIA_LIST),
  mediaSaveProvider: (cfg: any) => ipcRenderer.invoke(IPC.MEDIA_SAVE_PROVIDER, cfg),
  mediaDeleteProvider: (id: string) => ipcRenderer.invoke(IPC.MEDIA_DELETE_PROVIDER, id),
  mediaTestProvider: (id: string) => ipcRenderer.invoke(IPC.MEDIA_TEST_PROVIDER, id),
  mediaGenerate: (req: any) => ipcRenderer.invoke(IPC.MEDIA_GENERATE, req),
  mediaCancel: (id: string) => ipcRenderer.invoke(IPC.MEDIA_CANCEL, id),
  mediaDeleteArtifact: (id: string) => ipcRenderer.invoke(IPC.MEDIA_DELETE_ARTIFACT, id),
  mediaOpenArtifact: (id: string) => ipcRenderer.invoke(IPC.MEDIA_OPEN_ARTIFACT, id),
  mediaRevealArtifact: (id: string) => ipcRenderer.invoke(IPC.MEDIA_REVEAL_ARTIFACT, id),
  onMediaStatus: (cb: (e: any) => void) => {
    const l = (_: any, d: any) => cb(d);
    ipcRenderer.on(IPC.MEDIA_STATUS_CHANGED, l);
    return () => ipcRenderer.off(IPC.MEDIA_STATUS_CHANGED, l);
  },
`;

  // Insert before the closing brace of api object (after onModelsUpdated block)
  if (!s.includes('mediaList:')) {
    s = s.replace(
      /onModelsUpdated[^}]*\}\),[\n\s]+(\n\};)/,
      `onModelsUpdated: (cb: (data: { id: string; models: ProviderModel[]; fetchedAt: number }) => void) => {
    const l = (_: IpcRendererEvent, d: any) => cb(d);
    ipcRenderer.on(IPC.PROVIDER_MODELS_UPDATED, l);
    return () => ipcRenderer.off(IPC.PROVIDER_MODELS_UPDATED, l);
  }${apiAppend}$1`
    );
    write(f, s);
    log.push('OK preload/index.ts');
  } else {
    log.push('SKIP preload/index.ts (already has media)');
  }
}

console.log(log.join('\n'));
