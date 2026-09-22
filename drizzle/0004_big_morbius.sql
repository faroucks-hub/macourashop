CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`currency` text NOT NULL,
	`amount` integer NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`spent_on` text NOT NULL,
	`created` text NOT NULL,
	`voided` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_request_key_unique` ON `expenses` (`request_key`);--> statement-breakpoint
CREATE INDEX `expenses_date` ON `expenses` (`spent_on`);--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`status` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_order` ON `order_events` (`order_id`,`created`);--> statement-breakpoint
CREATE TABLE `tracking_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`attempts` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `order_lines` ADD `costs` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `tracking_code` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_cost` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_tracking` ON `orders` (`tracking_code`);--> statement-breakpoint
ALTER TABLE `products` ADD `costs` text DEFAULT '{}' NOT NULL;