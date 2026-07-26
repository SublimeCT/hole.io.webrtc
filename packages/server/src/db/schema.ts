import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const rooms = pgTable(
  "rooms",
  {
    code: text("code").primaryKey(),
    hostPeerId: text("host_peer_id").notNull(),
    status: text("status").notNull(),
    cycle: integer("cycle").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    check("rooms_code_format", sql`${table.code} ~ '^[A-HJ-NP-Z2-9]{6}$'`),
    check(
      "rooms_status_valid",
      sql`${table.status} in ('lobby', 'connecting', 'playing', 'closed')`,
    ),
    check("rooms_cycle_positive", sql`${table.cycle} > 0`),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: text("id").primaryKey(),
    roomCode: text("room_code")
      .notNull()
      .references(() => rooms.code),
    cycle: integer("cycle").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    finishReason: text("finish_reason"),
  },
  (table) => [
    check("matches_cycle_positive", sql`${table.cycle} > 0`),
    check("matches_time_order", sql`${table.endsAt} > ${table.startedAt}`),
    check(
      "matches_finish_reason_valid",
      sql`${table.finishReason} is null or ${table.finishReason} in ('time-limit', 'host-timeout', 'host-left', 'closed', 'server-shutdown')`,
    ),
  ],
);

export const matchPlayers = pgTable(
  "match_players",
  {
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id),
    peerId: text("peer_id").notNull(),
    playerName: text("player_name").notNull(),
    color: text("color").notNull(),
    language: text("language").notNull(),
    platform: text("platform").notNull(),
    isHost: boolean("is_host").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.peerId] }),
    check("match_players_name_length", sql`char_length(${table.playerName}) between 2 and 10`),
    check("match_players_color_format", sql`${table.color} ~ '^#[0-9A-F]{6}$'`),
    check(
      "match_players_language_valid",
      sql`${table.language} in ('zh-CN', 'zh-TW', 'en', 'fr', 'ja', 'es', 'ko', 'de', 'pt', 'ar')`,
    ),
    check("match_players_platform_length", sql`char_length(${table.platform}) between 1 and 20`),
  ],
);

export const ipAccessStates = pgTable(
  "ip_access_states",
  {
    ip: text("ip").primaryKey(),
    consecutiveMisses: integer("consecutive_misses").notNull().default(0),
    totalMisses: integer("total_misses").notNull().default(0),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
    permanentlyBlocked: boolean("permanently_blocked").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("ip_access_consecutive_nonnegative", sql`${table.consecutiveMisses} >= 0`),
    check("ip_access_total_nonnegative", sql`${table.totalMisses} >= 0`),
  ],
);
