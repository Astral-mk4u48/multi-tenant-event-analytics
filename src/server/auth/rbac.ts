export type Role = "OWNER" | "ADMIN" | "VIEWER";

export type Capability =
  | "view_analytics"
  | "inspect_payloads"
  | "manage_webhooks"
  | "reveal_secrets"
  | "replay_webhooks"
  | "purge_dlq"
  | "manage_keys"
  | "manage_team"
  | "delete_organization";

// RBAC capability matrix per Section 2.3 of the Master Engineering Specification
const PERMISSIONS: Record<Role, Record<Capability, boolean>> = {
  OWNER: {
    view_analytics: true,
    inspect_payloads: true,
    manage_webhooks: true,
    reveal_secrets: true,
    replay_webhooks: true,
    purge_dlq: true,
    manage_keys: true,
    manage_team: true,
    delete_organization: true,
  },
  ADMIN: {
    view_analytics: true,
    inspect_payloads: true,
    manage_webhooks: true,
    reveal_secrets: true,
    replay_webhooks: true,
    purge_dlq: true,
    manage_keys: true,
    manage_team: true, // Can invite VIEWER and ADMIN only
    delete_organization: false,
  },
  VIEWER: {
    view_analytics: true,
    inspect_payloads: true,
    manage_webhooks: false,
    reveal_secrets: false,
    replay_webhooks: false,
    purge_dlq: false,
    manage_keys: false,
    manage_team: false,
    delete_organization: false,
  },
};

export function hasPermission(role: Role, capability: Capability): boolean {
  return PERMISSIONS[role]?.[capability] ?? false;
}

export function requireRole(userRole: Role, allowedRoles: Role[]): boolean {
  return allowedRoles.includes(userRole);
}

export function canInviteRole(inviterRole: Role, roleToInvite: Role): boolean {
  if (inviterRole === "OWNER") return true;
  if (inviterRole === "ADMIN") return roleToInvite !== "OWNER";
  return false;
}
