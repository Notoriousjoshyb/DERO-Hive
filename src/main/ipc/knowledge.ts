import { ipcMain } from 'electron';
import {
  IPC,
  type KnowledgeAutomationKind,
  type KnowledgeAutomationSaveRequest,
  type KnowledgeAppendRequest,
  type KnowledgeCaptureRequest,
  type KnowledgeOpenRequest,
  type KnowledgePatchRequest
} from '@shared/types';
import type { KnowledgeService } from '../knowledge/service';
import type { KnowledgeAutomationScheduler } from '../knowledge/automation';

export function registerKnowledgeHandlers(service: KnowledgeService, automations: KnowledgeAutomationScheduler): void {
  ipcMain.handle(IPC.KNOWLEDGE_STATUS, (_event, projectId: string) => service.status(projectId));
  ipcMain.handle(IPC.KNOWLEDGE_LIST, (_event, input: { projectId: string; path?: string }) =>
    service.list(input.projectId, input.path));
  ipcMain.handle(IPC.KNOWLEDGE_READ, (_event, input: { projectId: string; path: string }) =>
    service.read(input.projectId, input.path));
  ipcMain.handle(IPC.KNOWLEDGE_SEARCH, (_event, input: { projectId: string; query: string; limit?: number; contextLength?: number }) =>
    service.search(input.projectId, input.query, input.limit, input.contextLength));
  ipcMain.handle(IPC.KNOWLEDGE_BOOTSTRAP, (_event, projectId: string) => service.bootstrap(projectId, { automated: true }));
  ipcMain.handle(IPC.KNOWLEDGE_CAPTURE, (_event, input: KnowledgeCaptureRequest) => service.capture(input, { automated: true }));
  ipcMain.handle(IPC.KNOWLEDGE_APPEND, (_event, input: KnowledgeAppendRequest) => service.append(input, { automated: true }));
  ipcMain.handle(IPC.KNOWLEDGE_PATCH, (_event, input: KnowledgePatchRequest) => service.patch(input, { automated: true }));
  ipcMain.handle(IPC.KNOWLEDGE_OPEN, (_event, input: KnowledgeOpenRequest) => service.open(input));
  ipcMain.handle(IPC.KNOWLEDGE_RETRY_OUTBOX, (_event, projectId?: string) => service.retryOutbox(projectId, { automated: true }));
  ipcMain.handle(IPC.KNOWLEDGE_AUTOMATION_LIST, (_event, projectId?: string) => automations.list(projectId));
  ipcMain.handle(IPC.KNOWLEDGE_AUTOMATION_SAVE, (_event, input: KnowledgeAutomationSaveRequest) => automations.save(input));
  ipcMain.handle(IPC.KNOWLEDGE_AUTOMATION_DELETE, (_event, input: { projectId: string; kind: KnowledgeAutomationKind }) => {
    automations.delete(input.projectId, input.kind);
    return { ok: true };
  });
  ipcMain.handle(IPC.KNOWLEDGE_AUTOMATION_RUN_NOW, (_event, input: { projectId: string; kind: KnowledgeAutomationKind }) =>
    automations.runNow(input.projectId, input.kind));
  ipcMain.handle(IPC.KNOWLEDGE_AUTOMATION_STATUS, (_event, projectId?: string) => automations.status(projectId));
}
