// WebRTC DataChannel 上传输的游戏消息编解码。
// 心跳与断线检测由信令 WSS（4s application heartbeat）和 starConnection 的连接状态回调承担，
// 本模块只负责把高频游戏消息在对象与 JSON 文本之间转换，供 OnlineGameDriver 使用。
import type { GameEvent, InputPacket, StateDeltaSnapshot } from "@hole-io/shared/protocol";

/** DataChannel 上承载的游戏消息联合（房间/心跳走信令 WSS，不在此列）。 */
export type GameDataMessage = InputPacket | StateDeltaSnapshot | GameEvent;

export function encodeGameData(message: GameDataMessage): string {
  return JSON.stringify(message);
}

/** 解析失败或结构不合法返回 null，由调用方丢弃（unreliable 丢包语义天然容忍）。 */
export function decodeGameData(raw: string): GameDataMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || !("type" in parsed)) return null;
  return parsed as GameDataMessage;
}
