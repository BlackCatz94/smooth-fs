CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_folder_id_idx" ON "files" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "files_deleted_at_idx" ON "files" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "folders_parent_id_idx" ON "folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "folders_parent_id_name_idx" ON "folders" USING btree ("parent_id","name");--> statement-breakpoint
CREATE INDEX "folders_deleted_at_idx" ON "folders" USING btree ("deleted_at");