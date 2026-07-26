ALTER TABLE "ip_access_states" ADD CONSTRAINT "ip_access_consecutive_nonnegative" CHECK ("ip_access_states"."consecutive_misses" >= 0);--> statement-breakpoint
ALTER TABLE "ip_access_states" ADD CONSTRAINT "ip_access_total_nonnegative" CHECK ("ip_access_states"."total_misses" >= 0);--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_name_length" CHECK (char_length("match_players"."player_name") between 2 and 10);--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_color_format" CHECK ("match_players"."color" ~ '^#[0-9A-F]{6}$');--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_language_valid" CHECK ("match_players"."language" in ('zh-CN', 'zh-TW', 'en', 'fr', 'ja', 'es', 'ko', 'de', 'pt', 'ar'));--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_platform_length" CHECK (char_length("match_players"."platform") between 1 and 20);--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_cycle_positive" CHECK ("matches"."cycle" > 0);--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_time_order" CHECK ("matches"."ends_at" > "matches"."started_at");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_finish_reason_valid" CHECK ("matches"."finish_reason" is null or "matches"."finish_reason" in ('time-limit', 'host-timeout', 'host-left', 'closed', 'server-shutdown'));--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_code_format" CHECK ("rooms"."code" ~ '^[A-HJ-NP-Z2-9]{6}$');--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_status_valid" CHECK ("rooms"."status" in ('lobby', 'connecting', 'playing', 'closed'));--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_cycle_positive" CHECK ("rooms"."cycle" > 0);