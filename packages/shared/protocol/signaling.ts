import { Type, type Static, type TProperties } from "@sinclair/typebox";
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

export const PeerIdSchema = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: "^[A-Za-z0-9-]+$",
});
export const RoomCodeSchema = Type.String({
  minLength: 6,
  maxLength: 6,
  pattern: ROOM_CODE_PATTERN,
});
const LanguageSchema = Type.Union(SUPPORTED_LANGUAGES.map((language) => Type.Literal(language)));

export const PlayerProfileSchema = Type.Object(
  {
    // TypeBox uses UTF-16 code units for maxLength. The exact 2–10 Unicode code-point
    // rule is enforced by normalizePlayerProfile after this broad structural gate.
    playerName: Type.String({ minLength: 1, maxLength: 20 }),
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

const RoomStatusSchema = Type.Union([
  Type.Literal("lobby"),
  Type.Literal("connecting"),
  Type.Literal("playing"),
]);
const RoomPeerSchema = Type.Object(
  {
    peerId: PeerIdSchema,
    profile: PlayerProfileSchema,
    isHost: Type.Boolean(),
    entered: Type.Boolean(),
    ready: Type.Boolean(),
  },
  { additionalProperties: false },
);
const NullableTimestampSchema = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]);
const RoomStateSchema = Type.Object(
  {
    roomCode: RoomCodeSchema,
    status: RoomStatusSchema,
    cycle: Type.Integer({ minimum: 1 }),
    peers: Type.Array(RoomPeerSchema, { maxItems: 5 }),
    lobbyExpiresAt: NullableTimestampSchema,
    connectionExpiresAt: NullableTimestampSchema,
    matchEndsAt: NullableTimestampSchema,
  },
  { additionalProperties: false },
);
const TurnCredentialsSchema = Type.Object(
  {
    username: Type.String({ minLength: 1, maxLength: 128 }),
    credential: Type.String({ minLength: 1, maxLength: 256 }),
    ttl: Type.Integer({ minimum: 60, maximum: 86_400 }),
    stunUris: Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), {
      minItems: 1,
      maxItems: 8,
    }),
    uris: Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), {
      minItems: 1,
      maxItems: 8,
    }),
  },
  { additionalProperties: false },
);

export type RoomStatus = Static<typeof RoomStatusSchema>;
export type RoomPeer = Static<typeof RoomPeerSchema>;
export type RoomState = Static<typeof RoomStateSchema>;
export type TurnCredentials = Static<typeof TurnCredentialsSchema>;

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
const UpdateProfileSchema = Type.Object(
  { type: Type.Literal("update-profile"), profile: PlayerProfileSchema },
  { additionalProperties: false },
);
const KickPeerSchema = Type.Object(
  { type: Type.Literal("kick-peer"), peerId: PeerIdSchema },
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
  UpdateProfileSchema,
  KickPeerSchema,
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
  | "PLAYER_NAME_TAKEN"
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

const RoomClosedReasonSchema = Type.Union([
  Type.Literal("idle"),
  Type.Literal("host-timeout"),
  Type.Literal("host-left"),
  Type.Literal("closed"),
  Type.Literal("server-shutdown"),
]);
const RoomErrorCodeSchema = Type.Union([
  Type.Literal("INVALID_MESSAGE"),
  Type.Literal("ROOM_UNAVAILABLE"),
  Type.Literal("ROOM_FULL"),
  Type.Literal("PLAYER_NAME_TAKEN"),
  Type.Literal("ROOM_LIMIT_REACHED"),
  Type.Literal("ALREADY_IN_ROOM"),
  Type.Literal("NOT_IN_ROOM"),
  Type.Literal("NOT_HOST"),
  Type.Literal("NOT_READY"),
  Type.Literal("INVALID_STATE"),
  Type.Literal("MATCH_IN_PROGRESS"),
  Type.Literal("SIGNAL_NOT_ALLOWED"),
  Type.Literal("RATE_LIMITED"),
  Type.Literal("ACCESS_BLOCKED"),
  Type.Literal("INTERNAL_ERROR"),
]);
const MatchIdSchema = Type.String({ minLength: 1, maxLength: 64 });
const ServerMessage = <T extends string, P extends TProperties>(type: T, properties: P) =>
  Type.Object({ type: Type.Literal(type), ...properties }, { additionalProperties: false });

export const ServerToClientMessageSchema = Type.Union([
  ServerMessage("connected", {
    peerId: PeerIdSchema,
    heartbeatIntervalMs: Type.Integer({ minimum: 1000, maximum: 60_000 }),
    heartbeatTimeoutMs: Type.Integer({ minimum: 1000, maximum: 120_000 }),
  }),
  ServerMessage("room-created", { room: RoomStateSchema, turn: TurnCredentialsSchema }),
  ServerMessage("room-entered", { room: RoomStateSchema, turn: TurnCredentialsSchema }),
  ServerMessage("room-state", { room: RoomStateSchema }),
  ServerMessage("connection-started", { room: RoomStateSchema }),
  ServerMessage("signal-offer", {
    fromPeerId: PeerIdSchema,
    description: SessionDescriptionSchema,
  }),
  ServerMessage("signal-answer", {
    fromPeerId: PeerIdSchema,
    description: SessionDescriptionSchema,
  }),
  ServerMessage("signal-ice", { fromPeerId: PeerIdSchema, candidate: IceCandidateSchema }),
  ServerMessage("match-started", {
    matchId: MatchIdSchema,
    matchEndsAt: Type.Integer({ minimum: 0 }),
    room: RoomStateSchema,
  }),
  ServerMessage("match-ended", {
    matchId: MatchIdSchema,
    roomCode: RoomCodeSchema,
    rejoinDeadline: Type.Integer({ minimum: 0 }),
    reason: Type.Literal("time-limit"),
  }),
  ServerMessage("room-closed", {
    roomCode: RoomCodeSchema,
    reason: RoomClosedReasonSchema,
  }),
  ServerMessage("kicked", {
    roomCode: RoomCodeSchema,
  }),
  ServerMessage("heartbeat-ack", {
    clientTime: Type.Integer({ minimum: 0 }),
    serverTime: Type.Integer({ minimum: 0 }),
  }),
  ServerMessage("room-error", {
    code: RoomErrorCodeSchema,
    message: Type.String({ minLength: 1, maxLength: 256 }),
  }),
]);

export type ServerToClientMessage = Static<typeof ServerToClientMessageSchema>;

export function isClientToServerMessage(value: unknown): value is ClientToServerMessage {
  return Value.Check(ClientToServerMessageSchema, value);
}

export function isServerToClientMessage(value: unknown): value is ServerToClientMessage {
  return Value.Check(ServerToClientMessageSchema, value);
}

export function normalizePlayerProfile(profile: PlayerProfile): PlayerProfile | null {
  const playerName = profile.playerName.normalize("NFKC").trim();
  const platform = profile.platform.normalize("NFKC").trim();
  const nameLength = Array.from(playerName).length;
  const normalized = {
    playerName,
    color: profile.color.toUpperCase(),
    language: profile.language,
    platform,
  };
  if (
    nameLength < 2 ||
    nameLength > 10 ||
    !PLAYER_NAME_PATTERN.test(playerName) ||
    !Value.Check(PlayerProfileSchema, normalized)
  ) {
    return null;
  }
  return normalized;
}
