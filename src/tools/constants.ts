// Meridian FDE Demo — shared ticket domain constants
//
// Status/priority enums were being duplicated as local consts in every tool
// that touches tickets (update_ticket_status, search_tickets). Centralized
// here so a change to the ticket lifecycle only has to happen in one place.

export const TICKET_STATUSES = ["OPEN", "INVESTIGATING", "ESCALATED", "RESOLVED", "CLOSED"] as const;
export const TICKET_PRIORITIES = ["P1", "P2", "P3", "P4"] as const;

// Statuses considered "active" for default list/search scope — see
// CLAUDE.md: list/search tools default to the active subset, not the full
// table, unless the caller passes an explicit filter that overrides it.
export const ACTIVE_TICKET_STATUSES = ["OPEN", "INVESTIGATING", "ESCALATED"] as const;
