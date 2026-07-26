import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const ROOM_CODE_PATTERN = "^[A-HJ-NP-Z2-9]{6}$";
export const PLAYER_COLOR_PATTERN = "^#[0-9A-Fa-f]{6}$";
export const PLATFORM_PATTERN = "^[A-Za-z0-9 ._+()/#:-]{1,20}$";
export const PLAYER_NAME_PATTERN = /^[\p{L}\p{N}_ -]+$/u;
export const SUPPORTED_LANGUAGES = [
  "zh-CN",
  "zh-TW",
  "en",
  "fr",
  "ja",
  "es",
  "ko",
  "de",
  "pt",
  "ar",
] as const;

const PeerIdSchema = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: "^[A-Za-z0-9-]+$",
});
const RoomCodeSchema = Type.String({ minLength: 6, maxLength: 6, pattern: ROOM_CODE_PATTERN });
const LanguageSchema = Type.Union(SUPPORTED_LANGUAGES.map((language) => Type.Literal(language)));

export const PlayerProfileSchema = Type.Object(
  {
    playerName: Type.String({ minLength: 2, maxLength: 10 }),
    color: Type.String({ minLength: 7, maxLength: 7, pattern: PLAYER_COLOR_PATTERN }),
    language: LanguageSchema,
    platform: Type.String({ minLength: 1, maxLength: 20, pattern: PLATFORM_PATTERN }),
  },
  { additionalProperties: false },
);

export type PeerId = Static<typeof PeerIdSchema>;
export type RoomCode = Static<typeof RoomCodeSchema>;
export type PlayerProfile = Static<typeof PlayerProfileSchema>;
export type SupportedLanguage = Static<typeof LanguageSchema>;
export type RoomStatus = "lobby" | "connecting" | "playing";

export interface RoomPeer {
  peerId: PeerId;
  profile: PlayerProfile;
  isHost: boolean;
  entered: boolean;
  ready: boolean;
}

export interface RoomState {
  roomCode: RoomCode;
  status: RoomStatus;
  cycle: number;
  peers: readonly RoomPeer[];
  lobbyExpiresAt: number | null;
  connectionExpiresAt: number | null;
  matchEndsAt: number | null;
}

export interface TurnCredentials {
  username: string;
  credential: string;
  ttl: number;
  uris: readonly string[];
}

const CreateRoomSchema = Type.Object(
  { type: Type.Literal("create-room"), profile: PlayerProfileSchema },
  { additionalProperties: false },
);
const EnterRoomSchema = Type.Object(
  { type: Type.Literal("enter-room"), roomCode: RoomCodeSchema, profile: PlayerProfileSchema },
  { additionalProperties: false },
);
const SetReadySchema = Type.Object(
  { type: Type.Literal("set-ready"), ready: Type.Boolean() },
  { additionalProperties: false },
);
const EmptyMessage = <T extends string>(type: T) =>
  Type.Object({ type: Type.Literal(type) }, { additionalProperties: false });

const SessionDescriptionSchema = Type.Object(
  {
    sdp: Type.String({ minLength: 1, maxLength: 65_535 }),
  },
  { additionalProperties: false },
);
const IceCandidateSchema = Type.Object(
  {
    candidate: Type.String({ maxLength: 4096 }),
    sdpMid: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
    sdpMLineIndex: Type.Union([Type.Integer({ minimum: 0, maximum: 65_535 }), Type.Null()]),
    usernameFragment: Type.Optional(Type.Union([Type.String({ maxLength: 256 }), Type.Null()])),
  },
  { additionalProperties: false },
);
const SignalOfferSchema = Type.Object(
  {
    type: Type.Literal("signal-offer"),
    toPeerId: PeerIdSchema,
    description: SessionDescriptionSchema,
  },
  { additionalProperties: false },
);
const SignalAnswerSchema = Type.Object(
  {
    type: Type.Literal("signal-answer"),
    toPeerId: PeerIdSchema,
    description: SessionDescriptionSchema,
  },
  { additionalProperties: false },
);
const SignalIceSchema = Type.Object(
  {
    type: Type.Literal("signal-ice"),
    toPeerId: PeerIdSchema,
    candidate: IceCandidateSchema,
  },
  { additionalProperties: false },
);
const HeartbeatSchema = Type.Object(
  {
    type: Type.Literal("heartbeat"),
    clientTime: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const ClientToServerMessageSchema = Type.Union([
  CreateRoomSchema,
  EnterRoomSchema,
  SetReadySchema,
  EmptyMessage("begin-connection"),
  SignalOfferSchema,
  SignalAnswerSchema,
  SignalIceSchema,
  EmptyMessage("start-match"),
  EmptyMessage("leave-room"),
  EmptyMessage("close-room"),
  HeartbeatSchema,
]);

export type ClientToServerMessage = Static<typeof ClientToServerMessageSchema>;
export type SignalOutMessage = Extract<
  ClientToServerMessage,
  { type: "signal-offer" | "signal-answer" | "signal-ice" }
>;

export type RoomClosedReason = "idle" | "host-timeout" | "host-left" | "closed" | "server-shutdown";

export type RoomErrorCode =
  | "INVALID_MESSAGE"
  | "ROOM_UNAVAILABLE"
  | "ROOM_FULL"
  | "ROOM_LIMIT_REACHED"
  | "ALREADY_IN_ROOM"
  | "NOT_IN_ROOM"
  | "NOT_HOST"
  | "NOT_READY"
  | "INVALID_STATE"
  | "MATCH_IN_PROGRESS"
  | "SIGNAL_NOT_ALLOWED"
  | "RATE_LIMITED"
  | "ACCESS_BLOCKED"
  | "INTERNAL_ERROR";

export type ServerToClientMessage =
  | {
      type: "connected";
      peerId: PeerId;
      heartbeatIntervalMs: number;
      heartbeatTimeoutMs: number;
    }
  | { type: "room-created"; room: RoomState; turn: TurnCredentials }
  | { type: "room-entered"; room: RoomState; turn: TurnCredentials }
  | { type: "room-state"; room: RoomState }
  | { type: "connection-started"; room: RoomState }
  | {
      type: "signal-offer";
      fromPeerId: PeerId;
      description: { sdp: string };
    }
  | {
      type: "signal-answer";
      fromPeerId: PeerId;
      description: { sdp: string };
    }
  | {
      type: "signal-ice";
      fromPeerId: PeerId;
      candidate: Static<typeof IceCandidateSchema>;
    }
  | { type: "match-started"; matchId: string; matchEndsAt: number; room: RoomState }
  | {
      type: "match-ended";
      matchId: string;
      roomCode: RoomCode;
      rejoinDeadline: number;
      reason: "time-limit";
    }
  | { type: "room-closed"; roomCode: RoomCode; reason: RoomClosedReason }
  | { type: "heartbeat-ack"; clientTime: number; serverTime: number }
  | { type: "room-error"; code: RoomErrorCode; message: string };

export function isClientToServerMessage(value: unknown): value is ClientToServerMessage {
  return Value.Check(ClientToServerMessageSchema, value);
}

export function normalizePlayerProfile(profile: PlayerProfile): PlayerProfile | null {
  const playerName = profile.playerName.normalize("NFKC").trim();
  const platform = profile.platform.normalize("NFKC").trim();
  const nameLength = Array.from(playerName).length;
  if (
    nameLength < 2 ||
    nameLength > 10 ||
    !PLAYER_NAME_PATTERN.test(playerName) ||
    !new RegExp(PLATFORM_PATTERN).test(platform)
  ) {
    return null;
  }
  return {
    playerName,
    color: profile.color.toUpperCase(),
    language: profile.language,
    platform,
  };
}
