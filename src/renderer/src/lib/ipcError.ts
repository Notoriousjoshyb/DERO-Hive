// ipcRenderer.invoke wraps handler errors as
// "Error invoking remote method 'channel': Error: message" — unwrap for display.
export function ipcErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
