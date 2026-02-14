export type AuditAction = 
  | "TRADE_ENTER"
  | "TRADE_EXIT"
  | "POSITION_UPDATE"
  | "STOP_OVERRIDE"
  | "SETTINGS_CHANGE"
  | "PIPELINE_RUN"
  | "HERO_EXECUTE"
  | "HERO_PASS";

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  userId?: string;
  details: Record<string, unknown>;
  metadata?: {
    ip?: string;
    userAgent?: string;
  };
}

const auditLog: AuditEntry[] = [];

export function makeAuditId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function audit(
  action: AuditAction,
  details: Record<string, unknown>,
  options?: { userId?: string; ip?: string; userAgent?: string }
): AuditEntry {
  const entry: AuditEntry = {
    id: makeAuditId(),
    timestamp: new Date().toISOString(),
    action,
    details,
    ...(options?.userId && { userId: options.userId }),
    metadata: {
      ...(options?.ip && { ip: options.ip }),
      ...(options?.userAgent && { userAgent: options.userAgent }),
    },
  };
  
  auditLog.push(entry);
  
  if (process.env.AUDIT_LOG === "true") {
    console.log(`[AUDIT] ${entry.action} ${entry.id} ${JSON.stringify(entry.details)}`);
  }
  
  return entry;
}

export function getAuditLog(limit = 100): AuditEntry[] {
  return auditLog.slice(-limit);
}

export function getAuditLogByAction(action: AuditAction, limit = 50): AuditEntry[] {
  return auditLog.filter(e => e.action === action).slice(-limit);
}

export function clearAuditLog(): void {
  auditLog.length = 0;
}
