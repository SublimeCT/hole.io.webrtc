// 4 位去歧义房间码字母表（剔除 0/O/1/I 等易混字符），降低玩家口头/手输出错率。
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LENGTH = 4;
const MAX_ATTEMPTS = 32;

/** 生成一个不在 existing 中的 4 位房间码。 */
export function generateRoomCode(existing: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let code = "";
    for (let i = 0; i < LENGTH; i += 1) {
      code += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    }
    if (!existing.has(code)) return code;
  }
  // ALPHABET^LENGTH ≈ 81 万空间，32 次全碰撞的概率可忽略；
  // 到这里说明同一进程内活跃房间数已异常大。
  throw new Error("room code space exhausted");
}
