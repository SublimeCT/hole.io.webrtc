import { randomBytes } from "node:crypto";
import type { RoomCode } from "@hole-io/shared/protocol";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;

export function generateRoomCode(): RoomCode {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte & 31];
  return code as RoomCode;
}
