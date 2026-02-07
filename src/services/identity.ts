import { z } from "zod";
import type { Store } from "../store.js";
import type { AccessAuditRecord, TerminalRoute, UserProfile, UserRole } from "../types.js";
import { makeId, nowIso } from "../utils.js";

const roleSchema = z.enum(["viewer", "analyst", "operator", "admin"]);

const updateUserRoleSchema = z.object({
  role: roleSchema,
});

export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;

function hasSourceEntitlement(user: UserProfile, sourceId: string): boolean {
  return user.sourceEntitlements.includes("*") || user.sourceEntitlements.includes(sourceId);
}

function hasRouteEntitlement(user: UserProfile, route: TerminalRoute): boolean {
  return user.routeEntitlements.includes(route);
}

export class IdentityService {
  constructor(private readonly store: Store) {}

  async listUsers(): Promise<UserProfile[]> {
    const state = await this.store.read();
    return [...state.userProfiles].sort((a, b) => a.id.localeCompare(b.id));
  }

  async getUser(userId: string): Promise<UserProfile | null> {
    const state = await this.store.read();
    return state.userProfiles.find((user) => user.id === userId) ?? null;
  }

  async requireUser(userId: string): Promise<UserProfile> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new Error(`Unknown user ${userId}`);
    }
    return user;
  }

  async updateUserRole(userId: string, input: UpdateUserRoleInput): Promise<UserProfile> {
    const parsed = updateUserRoleSchema.parse(input);
    return this.store.transaction((state) => {
      const user = state.userProfiles.find((item) => item.id === userId);
      if (!user) {
        throw new Error(`Unknown user ${userId}`);
      }
      user.role = parsed.role;
      user.updatedAt = nowIso();
      return user;
    });
  }

  async authorizeRoute(user: UserProfile, route: TerminalRoute): Promise<{ allowed: boolean; reason: string }> {
    if (hasRouteEntitlement(user, route)) {
      return { allowed: true, reason: "Route entitlement granted" };
    }
    return { allowed: false, reason: `Route ${route} is not allowed for role ${user.role}` };
  }

  async authorizeSource(user: UserProfile, sourceId: string): Promise<{ allowed: boolean; reason: string }> {
    if (hasSourceEntitlement(user, sourceId)) {
      return { allowed: true, reason: "Source entitlement granted" };
    }
    return { allowed: false, reason: `Source ${sourceId} is not allowed for role ${user.role}` };
  }

  async authorizeRole(user: UserProfile, allowedRoles: UserRole[]): Promise<{ allowed: boolean; reason: string }> {
    if (allowedRoles.includes(user.role)) {
      return { allowed: true, reason: "Role entitlement granted" };
    }
    return { allowed: false, reason: `Role ${user.role} is not allowed` };
  }

  async auditAccess(input: {
    userId: string;
    role: UserRole;
    action: string;
    resource: string;
    allowed: boolean;
    reason: string;
  }): Promise<AccessAuditRecord> {
    return this.store.transaction((state) => {
      const record: AccessAuditRecord = {
        id: makeId("access"),
        userId: input.userId,
        role: input.role,
        action: input.action,
        resource: input.resource,
        allowed: input.allowed,
        reason: input.reason,
        createdAt: nowIso(),
      };
      state.accessAudits.push(record);
      if (state.accessAudits.length > 1000) {
        state.accessAudits = state.accessAudits.slice(-1000);
      }
      return record;
    });
  }

  async listAccessAudits(limit: number = 100): Promise<AccessAuditRecord[]> {
    const state = await this.store.read();
    return [...state.accessAudits]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}
