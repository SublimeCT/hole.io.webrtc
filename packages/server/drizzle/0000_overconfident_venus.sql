CREATE TABLE "ip_access_states" (
	"ip" text PRIMARY KEY NOT NULL,
	"consecutive_misses" integer DEFAULT 0 NOT NULL,
	"total_misses" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	"permanently_blocked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_players" (
	"match_id" text NOT NULL,
	"peer_id" text NOT NULL,
	"player_name" text NOT NULL,
	"color" text NOT NULL,
	"language" text NOT NULL,
	"platform" text NOT NULL,
	"is_host" boolean NOT NULL,
	CONSTRAINT "match_players_match_id_peer_id_pk" PRIMARY KEY("match_id","peer_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" text PRIMARY KEY NOT NULL,
	"room_code" text NOT NULL,
	"cycle" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"finish_reason" text
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"code" text PRIMARY KEY NOT NULL,
	"host_peer_id" text NOT NULL,
	"status" text NOT NULL,
	"cycle" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_room_code_rooms_code_fk" FOREIGN KEY ("room_code") REFERENCES "public"."rooms"("code") ON DELETE no action ON UPDATE no action;