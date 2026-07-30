import type { RoomCode } from "@hole-io/shared/protocol";

// 本机会话角色持久化，仅用于区分「刷新页面」时本端曾是房主还是 guest：
// 房主刷新 = 退出房间（回主页，旧房间由服务端心跳超时解散）；guest 刷新 = 重新进入房间。
// 内存里的 session 在页面刷新后必然丢失，因此必须落在 localStorage。
const ROOM_ROLE_KEY = "hole-city-room-role";

export type RoomRole = "host" | "guest";

interface StoredRoomRole {
  roomCode: RoomCode;
  role: RoomRole;
}

export function readRoomRole(): StoredRoomRole | null {
  try {
    const stored = localStorage.getItem(ROOM_ROLE_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "roomCode" in parsed &&
      "role" in parsed &&
      typeof (parsed as { roomCode: unknown }).roomCode === "string" &&
      ((parsed as { role: unknown }).role === "host" ||
        (parsed as { role: unknown }).role === "guest")
    ) {
      const value = parsed as StoredRoomRole;
      return { roomCode: value.roomCode as RoomCode, role: value.role };
    }
  } catch {
    // Persistent role is optional in restricted browser contexts.
  }
  return null;
}

export function writeRoomRole(roomCode: RoomCode, role: RoomRole): void {
  try {
    localStorage.setItem(ROOM_ROLE_KEY, JSON.stringify({ roomCode, role }));
  } catch {
    // Storage may be unavailable; refresh-role detection degrades to "guest".
  }
}

export function clearRoomRole(): void {
  try {
    localStorage.removeItem(ROOM_ROLE_KEY);
  } catch {
    // Nothing to do if storage is unavailable.
  }
}
