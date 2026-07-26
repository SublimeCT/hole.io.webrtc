import type { Persistence, IpAccessState } from "./persistence.js";

export class MemoryPersistence implements Persistence {
  private readonly roomCodes = new Set<string>();
  private readonly access = new Map<string, IpAccessState>();

  async reserveRoom(input: Parameters<Persistence["reserveRoom"]>[0]): Promise<boolean> {
    if (this.roomCodes.has(input.code)) return false;
    this.roomCodes.add(input.code);
    return true;
  }

  async updateRoom(_input: Parameters<Persistence["updateRoom"]>[0]): Promise<void> {}

  async createMatch(_input: Parameters<Persistence["createMatch"]>[0]): Promise<void> {}

  async finishMatch(_input: Parameters<Persistence["finishMatch"]>[0]): Promise<void> {}

  async getIpAccess(ip: string): Promise<IpAccessState | null> {
    const state = this.access.get(ip);
    return state === undefined ? null : { ...state };
  }

  async saveIpAccess(state: IpAccessState): Promise<void> {
    this.access.set(state.ip, { ...state });
  }

  async health(): Promise<boolean> {
    return true;
  }
}
