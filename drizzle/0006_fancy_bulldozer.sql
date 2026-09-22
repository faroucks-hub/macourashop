CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`type` text NOT NULL,
	`quantity` integer NOT NULL,
	`available_delta` integer NOT NULL,
	`unusable_delta` integer DEFAULT 0 NOT NULL,
	`expected_physical` integer,
	`counted_physical` integer,
	`supplier` text DEFAULT '' NOT NULL,
	`note` text NOT NULL,
	`currency` text,
	`unit_cost` integer,
	`created` text NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_movements_variant_created` ON `inventory_movements` (`variant_id`,`created`);--> statement-breakpoint
CREATE INDEX `inventory_movements_created` ON `inventory_movements` (`created`);