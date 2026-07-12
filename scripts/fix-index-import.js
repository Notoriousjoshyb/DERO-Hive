const fs = require('fs');
const path = require('path');
const p = path.join('C:/Users/joshu/Desktop/dero toolbox/DERO-Hive/', 'src/main/index.ts');
let s = fs.readFileSync(p, 'utf8');
const a = "import { registerKnowledgeHandlers } from './ipc/knowledge';\r\nimport { initDb, closeDb, getSetting } from './db/client';";
const b = "import { registerKnowledgeHandlers } from './ipc/knowledge';\r\nimport { registerMediaHandlers } from './ipc/media';\r\nimport { MediaManager } from './media/manager';\r\nimport { initDb, closeDb, getSetting } from './db/client';";
if (s.includes(a)) {
  s = s.replace(a, b);
  fs.writeFileSync(p, s);
  console.log('OK replaced');
} else {
  console.log('MISS');
}
