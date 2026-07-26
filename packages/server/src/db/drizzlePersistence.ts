import { eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { ipAccessStates, matches, matchPlayers, rooms } from "./schema.js";
import type { IpAccessState, Persistence } from "./persistence.js";

type Database = NodePgDatabase<{
  rooms: typeof rooms;
  matches: typeof matches;
  matchPlayers: typeof matchPlayers;
  ipAccessStates: typeof ipAccessStates;
}>;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

export class DrizzlePersistence implements Persistence {
  private readonly db: Database;
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
    this.db = drizzle(pool, {
      schema: { rooms, matches, matchPlayers, ipAccessStates },
    });
  }

  async reserveRoom(input: Parameters<Persistence["reserveRoom"]>[0]): Promise<boolean> {
    try {
      await this.db.insert(rooms).values({
        code: input.code,
        hostPeerId: input.hostPeerId,
        status: input.status,
        cycle: input.cycle,
        createdAt: new Date(input.now),
        updatedAt: new Date(input.now),
      });
      return true;
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async updateRoom(input: Parameters<Persistence["updateRoom"]>[0]): Promise<void> {
    await this.db
      .update(rooms)
      .set({
        status: input.status,
        cycle: input.cycle,
        updatedAt: new Date(input.now),
        closedAt: input.closedAt === undefined ? undefined : new Date(input.closedAt),
      })
      .where(eq(rooms.code, input.code));
  }

  async createMatch(input: Parameters<Persistence["createMatch"]>[0]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(matches).values({
        id: input.id,
        roomCode: input.roomCode,
        cycle: input.cycle,
        startedAt: new Date(input.startedAt),
        endsAt: new Date(input.endsAt),
      });
      await tx.insert(matchPlayers).values(
        input.members.map((member) => ({
          matchId: input.id,
          peerId: member.peerId,
          playerName: member.profile.playerName,
          color: member.profile.color,
          language: member.profile.language,
          platform: member.profile.platform,
          isHost: member.isHost,
        })),
      );
    });
  }

  async finishMatch(input: Parameters<Persistence["finishMatch"]>[0]): Promise<void> {
    await this.db
      .update(matches)
      .set({ finishedAt: new Date(input.finishedAt), finishReason: input.reason })
      .where(eq(matches.id, input.id));
  }

  async getIpAccess(ip: string): Promise<IpAccessState | null> {
    const rows = await this.db
      .select()
      .from(ipAccessStates)
      .where(eq(ipAccessStates.ip, ip))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      ip: row.ip,
      consecutiveMisses: row.consecutiveMisses,
      totalMisses: row.totalMisses,
      blockedUntil: row.blockedUntil?.getTime() ?? null,
      permanentlyBlocked: row.permanentlyBlocked,
      updatedAt: row.updatedAt.getTime(),
    };
  }

  async saveIpAccess(state: IpAccessState): Promise<void> {
    await this.db
      .insert(ipAccessStates)
      .values({
        ip: state.ip,
        consecutiveMisses: state.consecutiveMisses,
        totalMisses: state.totalMisses,
        blockedUntil: state.blockedUntil === null ? null : new Date(state.blockedUntil),
        permanentlyBlocked: state.permanentlyBlocked,
        updatedAt: new Date(state.updatedAt),
      })
      .onConflictDoUpdate({
        target: ipAccessStates.ip,
        set: {
          consecutiveMisses: state.consecutiveMisses,
          totalMisses: state.totalMisses,
          blockedUntil: state.blockedUntil === null ? null : new Date(state.blockedUntil),
          permanentlyBlocked: state.permanentlyBlocked,
          updatedAt: new Date(state.updatedAt),
        },
      });
  }

  async health(): Promise<boolean> {
    try {
      await this.pool.query("select 1");
      return true;
    } catch {
      return false;
    }
  }
}
