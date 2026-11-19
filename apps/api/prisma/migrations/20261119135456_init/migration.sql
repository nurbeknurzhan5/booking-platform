-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('pending_otp', 'confirmed', 'completed', 'no_show', 'cancelled_by_client', 'cancelled_by_admin', 'expired_otp');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'grace_period', 'expired', 'suspended');

-- CreateEnum
CREATE TYPE "PageStatus" AS ENUM ('active', 'temporarily_closed', 'disabled');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('specialist', 'cabinet', 'hall', 'equipment', 'vehicle', 'service_bay', 'other');

-- CreateEnum
CREATE TYPE "TranslationStatus" AS ENUM ('missing', 'auto_translated', 'verified', 'manually_edited');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sending', 'sent', 'delivered', 'read', 'failed', 'dead', 'cancelled');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('whatsapp', 'sms', 'email', 'dev_inbox');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('percent', 'fixed');

-- CreateEnum
CREATE TYPE "PromotionKind" AS ENUM ('promo_code', 'sale');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('published', 'hidden');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('draft', 'published', 'disabled');

-- CreateEnum
CREATE TYPE "MultiServiceMode" AS ENUM ('sequential', 'parallel');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'done', 'failed', 'dead');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT,
    "phone" VARCHAR(16),
    "phone_verified_at" TIMESTAMPTZ(3),
    "name" VARCHAR(200) NOT NULL,
    "password_hash" TEXT,
    "is_superadmin" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret_enc" TEXT,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "locale" VARCHAR(2) NOT NULL DEFAULT 'ru',
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "blocked_at" TIMESTAMPTZ(3),
    "blocked_reason" TEXT,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "mfa_verified" BOOLEAN NOT NULL DEFAULT false,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(500),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone" VARCHAR(16) NOT NULL,
    "purpose" VARCHAR(20) NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "appointment_id" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "permissions" (
    "code" VARCHAR(60) NOT NULL,
    "scope" VARCHAR(10) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_code" VARCHAR(30) NOT NULL,
    "permission_code" VARCHAR(60) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_code","permission_code")
);

-- CreateTable
CREATE TABLE "user_organization_roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role_code" VARCHAR(30) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "user_organization_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_access" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_branch_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_permissions" (
    "access_id" UUID NOT NULL,
    "permission_code" VARCHAR(60) NOT NULL,

    CONSTRAINT "user_branch_permissions_pkey" PRIMARY KEY ("access_id","permission_code")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "actor_user_id" UUID,
    "actor_type" VARCHAR(20) NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_id" VARCHAR(64),
    "before" JSONB,
    "after" JSONB,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_categories" (
    "code" VARCHAR(40) NOT NULL,
    "name_ru" VARCHAR(100) NOT NULL,
    "name_kk" VARCHAR(100) NOT NULL,
    "name_en" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_categories_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "business_category_code" VARCHAR(40) NOT NULL,
    "description" TEXT,
    "contacts" JSONB NOT NULL DEFAULT '{}',
    "default_locale" VARCHAR(2) NOT NULL DEFAULT 'ru',
    "notification_settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "max_branches" INTEGER NOT NULL,
    "monthly_price" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "max_branches" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "grace_days" INTEGER NOT NULL DEFAULT 7,
    "status" "SubscriptionStatus" NOT NULL,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "suspended_reason" TEXT,
    "last_payment_at" TIMESTAMPTZ(3),
    "last_payment_amount" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "method" VARCHAR(30) NOT NULL,
    "reference" VARCHAR(200),
    "note" TEXT,
    "recorded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "from_status" "SubscriptionStatus",
    "to_status" "SubscriptionStatus",
    "snapshot" JSONB NOT NULL,
    "actor_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "address" VARCHAR(500),
    "phone" VARCHAR(16),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Almaty',
    "description" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "map_url" VARCHAR(500),
    "map_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_settings" (
    "branch_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "slot_interval_minutes" INTEGER NOT NULL DEFAULT 15,
    "hold_minutes" INTEGER NOT NULL DEFAULT 5,
    "hold_extension_allowed" BOOLEAN NOT NULL DEFAULT true,
    "min_lead_minutes" INTEGER NOT NULL DEFAULT 60,
    "max_horizon_days" INTEGER NOT NULL DEFAULT 60,
    "reschedule_deadline_minutes" INTEGER NOT NULL DEFAULT 120,
    "cancel_deadline_minutes" INTEGER NOT NULL DEFAULT 120,
    "allow_late_cancel_exception" BOOLEAN NOT NULL DEFAULT false,
    "max_active_appointments_per_client" INTEGER NOT NULL DEFAULT 3,
    "allow_rebook_with_active" BOOLEAN NOT NULL DEFAULT true,
    "admin_can_override_client_limits" BOOLEAN NOT NULL DEFAULT true,
    "multi_service_mode" "MultiServiceMode" NOT NULL DEFAULT 'sequential',
    "load_balancing" BOOLEAN NOT NULL DEFAULT true,
    "specialist_pricing_enabled" BOOLEAN NOT NULL DEFAULT false,
    "reminder_hours_before" INTEGER NOT NULL DEFAULT 24,
    "online_booking_enabled" BOOLEAN NOT NULL DEFAULT true,
    "waitlist_enabled" BOOLEAN NOT NULL DEFAULT false,
    "waitlist_offer_minutes" INTEGER NOT NULL DEFAULT 15,
    "waitlist_recipients" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_settings_pkey" PRIMARY KEY ("branch_id")
);

-- CreateTable
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "category_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "photo_asset_id" UUID,
    "price" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "buffer_before_minutes" INTEGER NOT NULL DEFAULT 0,
    "buffer_after_minutes" INTEGER NOT NULL DEFAULT 0,
    "requires_specialist" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "online_booking_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_services" (
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "price_override" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_services_pkey" PRIMARY KEY ("branch_id","service_id")
);

-- CreateTable
CREATE TABLE "service_resources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "resource_type" "ResourceType" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "type" "ResourceType" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_services" (
    "organization_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_services_pkey" PRIMARY KEY ("resource_id","service_id")
);

-- CreateTable
CREATE TABLE "specialists" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "user_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "specialization" VARCHAR(200),
    "description" TEXT,
    "photo_asset_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "specialists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specialist_services" (
    "organization_id" UUID NOT NULL,
    "specialist_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "price_override" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "specialist_services_pkey" PRIMARY KEY ("specialist_id","service_id")
);

-- CreateTable
CREATE TABLE "working_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "resource_id" UUID,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breaks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "resource_id" UUID,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "breaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_exceptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "resource_id" UUID,
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "intervals" JSONB NOT NULL DEFAULT '[]',
    "reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "schedule_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "locale" VARCHAR(2) NOT NULL DEFAULT 'ru',
    "notes" TEXT,
    "merged_into_id" UUID,
    "anonymized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "client_id" UUID,
    "user_id" UUID,
    "phone" VARCHAR(16) NOT NULL,
    "consent_type" VARCHAR(30) NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "text_version" VARCHAR(20) NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "status" "AppointmentStatus" NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "locale" VARCHAR(2) NOT NULL DEFAULT 'ru',
    "comment" TEXT,
    "manage_token_hash" VARCHAR(64),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'KZT',
    "base_total" INTEGER NOT NULL,
    "sale_discount_total" INTEGER NOT NULL DEFAULT 0,
    "promo_discount_total" INTEGER NOT NULL DEFAULT 0,
    "total_price" INTEGER NOT NULL,
    "promo_code" VARCHAR(50),
    "promotion_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "reminder_sent_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "visitor_session" VARCHAR(64),
    "utm" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "specialist_id" UUID,
    "position" INTEGER NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "buffer_before_minutes" INTEGER NOT NULL,
    "buffer_after_minutes" INTEGER NOT NULL,
    "service_name_snapshot" VARCHAR(200) NOT NULL,
    "specialist_name_snapshot" VARCHAR(200),
    "base_price" INTEGER NOT NULL,
    "sale_discount" INTEGER NOT NULL DEFAULT 0,
    "sale_promotion_id" UUID,
    "promo_discount" INTEGER NOT NULL DEFAULT 0,
    "final_price" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_resources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "appointment_item_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointment_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "from_status" "AppointmentStatus",
    "to_status" "AppointmentStatus" NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_user_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_reschedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "old_start_at" TIMESTAMPTZ(3) NOT NULL,
    "old_end_at" TIMESTAMPTZ(3) NOT NULL,
    "new_start_at" TIMESTAMPTZ(3) NOT NULL,
    "new_end_at" TIMESTAMPTZ(3) NOT NULL,
    "old_items" JSONB NOT NULL,
    "new_items" JSONB NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_reschedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_holds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "extension_count" INTEGER NOT NULL DEFAULT 0,
    "released_at" TIMESTAMPTZ(3),
    "release_reason" VARCHAR(20),
    "ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "service_ids" UUID[],
    "specialist_id" UUID,
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'waiting',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "offered_at" TIMESTAMPTZ(3),
    "offer_expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" VARCHAR(200) NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" "TemplateStatus" NOT NULL DEFAULT 'draft',
    "current_version_id" UUID,
    "preview_asset_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "page_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_template_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "PageStatus" NOT NULL DEFAULT 'active',
    "primary_locale" VARCHAR(2) NOT NULL DEFAULT 'ru',
    "moderation_blocked" BOOLEAN NOT NULL DEFAULT false,
    "moderation_reason" TEXT,
    "moderated_at" TIMESTAMPTZ(3),
    "moderated_by_user_id" UUID,
    "published_publication_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "public_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "template_id" UUID NOT NULL,
    "template_version_id" UUID NOT NULL,
    "color_scheme" VARCHAR(40) NOT NULL,
    "booking_button_position" VARCHAR(20) NOT NULL,
    "primary_locale" VARCHAR(2) NOT NULL,
    "has_changes" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "page_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_publications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "translations" JSONB NOT NULL DEFAULT '{}',
    "template_id" UUID NOT NULL,
    "template_version_id" UUID NOT NULL,
    "color_scheme" VARCHAR(40) NOT NULL,
    "booking_button_position" VARCHAR(20) NOT NULL,
    "primary_locale" VARCHAR(2) NOT NULL,
    "published_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "publication_id" UUID,
    "template_id" UUID,
    "actor_user_id" UUID,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_translations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "entity_id" UUID NOT NULL,
    "field" VARCHAR(60) NOT NULL,
    "locale" VARCHAR(2) NOT NULL,
    "text" TEXT,
    "status" "TranslationStatus" NOT NULL DEFAULT 'missing',
    "source" VARCHAR(10),
    "source_locale" VARCHAR(2) NOT NULL,
    "source_hash" VARCHAR(64),
    "is_outdated" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "page_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "kind" VARCHAR(30) NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "mime_type" VARCHAR(50) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "variants" JSONB NOT NULL,
    "original_name" VARCHAR(255),
    "uploaded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" VARCHAR(40) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "locale" VARCHAR(2) NOT NULL,
    "provider_template_name" VARCHAR(100),
    "category" VARCHAR(20) NOT NULL,
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "type" VARCHAR(40) NOT NULL,
    "dedupe_key" VARCHAR(200) NOT NULL,
    "appointment_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "event_id" UUID NOT NULL,
    "appointment_id" UUID,
    "client_id" UUID,
    "type" VARCHAR(40) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" VARCHAR(64) NOT NULL,
    "locale" VARCHAR(2) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "payload_encrypted" BOOLEAN NOT NULL DEFAULT false,
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "dedupe_key" VARCHAR(250) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "locked_by" VARCHAR(100),
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "provider_message_id" VARCHAR(200),
    "last_error" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "outbox_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "success" BOOLEAN NOT NULL,
    "provider_message_id" VARCHAR(200),
    "http_status" INTEGER,
    "error_code" VARCHAR(100),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "waba_id" VARCHAR(64) NOT NULL,
    "phone_number_id" VARCHAR(64) NOT NULL,
    "display_phone" VARCHAR(32),
    "access_token_enc" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_message_statuses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "outbox_id" UUID,
    "provider_message_id" VARCHAR(200) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "error_code" VARCHAR(50),
    "error_title" VARCHAR(300),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_message_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dev_inbox_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipient" VARCHAR(64) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dev_inbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "author_name" VARCHAR(200) NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'published',
    "reply" TEXT,
    "replied_at" TIMESTAMPTZ(3),
    "replied_by_user_id" UUID,
    "reported_at" TIMESTAMPTZ(3),
    "report_reason" TEXT,
    "moderation_reason" TEXT,
    "moderated_at" TIMESTAMPTZ(3),
    "moderated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "kind" "PromotionKind" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(50),
    "description" TEXT,
    "discount_type" "DiscountType" NOT NULL,
    "discount_value" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "branch_ids" UUID[],
    "all_branches" BOOLEAN NOT NULL DEFAULT true,
    "service_ids" UUID[],
    "all_services" BOOLEAN NOT NULL DEFAULT true,
    "min_amount" INTEGER,
    "usage_limit" INTEGER,
    "per_client_limit" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "show_on_page" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_redemptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "discount_amount" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visitor_hash" VARCHAR(64) NOT NULL,
    "session_id" VARCHAR(64),
    "utm_source" VARCHAR(100),
    "utm_medium" VARCHAR(100),
    "utm_campaign" VARCHAR(100),
    "utm_term" VARCHAR(100),
    "utm_content" VARCHAR(100),
    "referrer_host" VARCHAR(200),
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "appointment_id" UUID,
    "service_ids" UUID[],

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_daily_aggregates" (
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "page_views" INTEGER NOT NULL DEFAULT 0,
    "unique_visitors" INTEGER NOT NULL DEFAULT 0,
    "booking_clicks" INTEGER NOT NULL DEFAULT 0,
    "booking_starts" INTEGER NOT NULL DEFAULT 0,
    "bookings_created" INTEGER NOT NULL DEFAULT 0,
    "cancellations" INTEGER NOT NULL DEFAULT 0,
    "sources" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_daily_aggregates_pkey" PRIMARY KEY ("branch_id","date")
);

-- CreateTable
CREATE TABLE "integration_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "provider" VARCHAR(40) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret_enc" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" VARCHAR(60) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" VARCHAR(200) NOT NULL,
    "count" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "queue" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "dedupe_key" VARCHAR(200),
    "run_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "locked_at" TIMESTAMPTZ(3),
    "locked_by" VARCHAR(100),
    "last_error" TEXT,
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "otp_codes_phone_purpose_created_at_idx" ON "otp_codes"("phone", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "otp_codes_ip_created_at_idx" ON "otp_codes"("ip", "created_at");

-- CreateIndex
CREATE INDEX "otp_codes_appointment_id_idx" ON "otp_codes"("appointment_id");

-- CreateIndex
CREATE INDEX "user_organization_roles_organization_id_idx" ON "user_organization_roles"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_organization_roles_user_id_organization_id_key" ON "user_organization_roles"("user_id", "organization_id");

-- CreateIndex
CREATE INDEX "user_branch_access_organization_id_idx" ON "user_branch_access"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_branch_access_user_id_branch_id_key" ON "user_branch_access"("user_id", "branch_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organization_id_key" ON "subscriptions"("organization_id");

-- CreateIndex
CREATE INDEX "subscription_payments_organization_id_paid_at_idx" ON "subscription_payments"("organization_id", "paid_at");

-- CreateIndex
CREATE INDEX "subscription_history_organization_id_created_at_idx" ON "subscription_history"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "branches_slug_key" ON "branches"("slug");

-- CreateIndex
CREATE INDEX "branches_organization_id_idx" ON "branches"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_organization_id_id_key" ON "branches"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_settings_organization_id_branch_id_key" ON "booking_settings"("organization_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_organization_id_id_key" ON "service_categories"("organization_id", "id");

-- CreateIndex
CREATE INDEX "services_organization_id_sort_order_idx" ON "services"("organization_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "services_organization_id_id_key" ON "services"("organization_id", "id");

-- CreateIndex
CREATE INDEX "branch_services_organization_id_service_id_idx" ON "branch_services"("organization_id", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_resources_service_id_resource_type_key" ON "service_resources"("service_id", "resource_type");

-- CreateIndex
CREATE INDEX "resources_branch_id_type_idx" ON "resources"("branch_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "resources_organization_id_id_key" ON "resources"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "resources_organization_id_branch_id_id_key" ON "resources"("organization_id", "branch_id", "id");

-- CreateIndex
CREATE INDEX "resource_services_service_id_idx" ON "resource_services"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "specialists_resource_id_key" ON "specialists"("resource_id");

-- CreateIndex
CREATE INDEX "specialists_branch_id_idx" ON "specialists"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "specialists_organization_id_id_key" ON "specialists"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "specialists_organization_id_branch_id_resource_id_key" ON "specialists"("organization_id", "branch_id", "resource_id");

-- CreateIndex
CREATE INDEX "specialist_services_service_id_idx" ON "specialist_services"("service_id");

-- CreateIndex
CREATE INDEX "working_hours_branch_id_resource_id_idx" ON "working_hours"("branch_id", "resource_id");

-- CreateIndex
CREATE INDEX "breaks_branch_id_resource_id_idx" ON "breaks"("branch_id", "resource_id");

-- CreateIndex
CREATE INDEX "schedule_exceptions_branch_id_date_from_date_to_idx" ON "schedule_exceptions"("branch_id", "date_from", "date_to");

-- CreateIndex
CREATE INDEX "clients_organization_id_phone_idx" ON "clients"("organization_id", "phone");

-- CreateIndex
CREATE INDEX "clients_user_id_idx" ON "clients"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "clients_organization_id_id_key" ON "clients"("organization_id", "id");

-- CreateIndex
CREATE INDEX "client_consents_phone_consent_type_created_at_idx" ON "client_consents"("phone", "consent_type", "created_at");

-- CreateIndex
CREATE INDEX "client_consents_client_id_idx" ON "client_consents"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_manage_token_hash_key" ON "appointments"("manage_token_hash");

-- CreateIndex
CREATE INDEX "appointments_organization_id_branch_id_start_at_idx" ON "appointments"("organization_id", "branch_id", "start_at");

-- CreateIndex
CREATE INDEX "appointments_client_id_status_idx" ON "appointments"("client_id", "status");

-- CreateIndex
CREATE INDEX "appointments_status_start_at_idx" ON "appointments"("status", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_organization_id_id_key" ON "appointments"("organization_id", "id");

-- CreateIndex
CREATE INDEX "appointment_items_appointment_id_idx" ON "appointment_items"("appointment_id");

-- CreateIndex
CREATE INDEX "appointment_items_specialist_id_start_at_idx" ON "appointment_items"("specialist_id", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_items_organization_id_id_key" ON "appointment_items"("organization_id", "id");

-- CreateIndex
CREATE INDEX "appointment_resources_resource_id_start_at_idx" ON "appointment_resources"("resource_id", "start_at");

-- CreateIndex
CREATE INDEX "appointment_resources_appointment_id_idx" ON "appointment_resources"("appointment_id");

-- CreateIndex
CREATE INDEX "appointment_status_history_appointment_id_created_at_idx" ON "appointment_status_history"("appointment_id", "created_at");

-- CreateIndex
CREATE INDEX "appointment_reschedules_appointment_id_idx" ON "appointment_reschedules"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_holds_appointment_id_key" ON "booking_holds"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_holds_token_hash_key" ON "booking_holds"("token_hash");

-- CreateIndex
CREATE INDEX "booking_holds_expires_at_idx" ON "booking_holds"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_holds_organization_id_appointment_id_key" ON "booking_holds"("organization_id", "appointment_id");

-- CreateIndex
CREATE INDEX "waitlist_entries_branch_id_status_date_from_idx" ON "waitlist_entries"("branch_id", "status", "date_from");

-- CreateIndex
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "page_templates_key_key" ON "page_templates"("key");

-- CreateIndex
CREATE UNIQUE INDEX "page_templates_current_version_id_key" ON "page_templates"("current_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_template_versions_template_id_version_key" ON "page_template_versions"("template_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "public_pages_branch_id_key" ON "public_pages"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "public_pages_published_publication_id_key" ON "public_pages"("published_publication_id");

-- CreateIndex
CREATE UNIQUE INDEX "public_pages_organization_id_id_key" ON "public_pages"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "public_pages_organization_id_branch_id_key" ON "public_pages"("organization_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_drafts_page_id_key" ON "page_drafts"("page_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_drafts_organization_id_page_id_key" ON "page_drafts"("organization_id", "page_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_publications_page_id_version_key" ON "page_publications"("page_id", "version");

-- CreateIndex
CREATE INDEX "page_history_page_id_created_at_idx" ON "page_history"("page_id", "created_at");

-- CreateIndex
CREATE INDEX "page_translations_organization_id_status_idx" ON "page_translations"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "page_translations_organization_id_entity_type_entity_id_fie_key" ON "page_translations"("organization_id", "entity_type", "entity_id", "field", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storage_key_key" ON "media_assets"("storage_key");

-- CreateIndex
CREATE INDEX "media_assets_organization_id_kind_idx" ON "media_assets"("organization_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_organization_id_id_key" ON "media_assets"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_type_channel_locale_key" ON "notification_templates"("type", "channel", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "notification_events_dedupe_key_key" ON "notification_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_events_appointment_id_idx" ON "notification_events"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_dedupe_key_key" ON "notification_outbox"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_outbox_status_next_attempt_at_idx" ON "notification_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_outbox_organization_id_created_at_idx" ON "notification_outbox"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_outbox_appointment_id_idx" ON "notification_outbox"("appointment_id");

-- CreateIndex
CREATE INDEX "notification_outbox_provider_message_id_idx" ON "notification_outbox"("provider_message_id");

-- CreateIndex
CREATE INDEX "notification_attempts_outbox_id_idx" ON "notification_attempts"("outbox_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_phone_number_id_key" ON "whatsapp_accounts"("phone_number_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_message_statuses_provider_message_id_status_key" ON "whatsapp_message_statuses"("provider_message_id", "status");

-- CreateIndex
CREATE INDEX "dev_inbox_messages_recipient_created_at_idx" ON "dev_inbox_messages"("recipient", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_appointment_id_key" ON "reviews"("appointment_id");

-- CreateIndex
CREATE INDEX "reviews_branch_id_status_created_at_idx" ON "reviews"("branch_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_organization_id_appointment_id_key" ON "reviews"("organization_id", "appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_organization_id_id_key" ON "promotions"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_organization_id_code_key" ON "promotions"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemptions_appointment_id_key" ON "promotion_redemptions"("appointment_id");

-- CreateIndex
CREATE INDEX "promotion_redemptions_promotion_id_status_idx" ON "promotion_redemptions"("promotion_id", "status");

-- CreateIndex
CREATE INDEX "promotion_redemptions_promotion_id_client_id_idx" ON "promotion_redemptions"("promotion_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemptions_organization_id_appointment_id_key" ON "promotion_redemptions"("organization_id", "appointment_id");

-- CreateIndex
CREATE INDEX "analytics_events_branch_id_occurred_at_idx" ON "analytics_events"("branch_id", "occurred_at");

-- CreateIndex
CREATE INDEX "analytics_events_organization_id_occurred_at_idx" ON "analytics_events"("organization_id", "occurred_at");

-- CreateIndex
CREATE INDEX "analytics_daily_aggregates_organization_id_date_idx" ON "analytics_daily_aggregates"("organization_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "integration_settings_organization_id_provider_key" ON "integration_settings"("organization_id", "provider");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_expires_at_idx" ON "rate_limit_buckets"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_dedupe_key_key" ON "jobs"("dedupe_key");

-- CreateIndex
CREATE INDEX "jobs_queue_status_run_at_idx" ON "jobs"("queue", "status", "run_at");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "roles"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_organization_roles" ADD CONSTRAINT "user_organization_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_organization_roles" ADD CONSTRAINT "user_organization_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_organization_roles" ADD CONSTRAINT "user_organization_roles_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "roles"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_permissions" ADD CONSTRAINT "user_branch_permissions_access_id_fkey" FOREIGN KEY ("access_id") REFERENCES "user_branch_access"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_permissions" ADD CONSTRAINT "user_branch_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_business_category_code_fkey" FOREIGN KEY ("business_category_code") REFERENCES "business_categories"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_history" ADD CONSTRAINT "subscription_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_history" ADD CONSTRAINT "subscription_history_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "service_categories"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_photo_asset_id_fkey" FOREIGN KEY ("organization_id", "photo_asset_id") REFERENCES "media_assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_services" ADD CONSTRAINT "branch_services_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_services" ADD CONSTRAINT "branch_services_organization_id_service_id_fkey" FOREIGN KEY ("organization_id", "service_id") REFERENCES "services"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_organization_id_service_id_fkey" FOREIGN KEY ("organization_id", "service_id") REFERENCES "services"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_services" ADD CONSTRAINT "resource_services_organization_id_resource_id_fkey" FOREIGN KEY ("organization_id", "resource_id") REFERENCES "resources"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_services" ADD CONSTRAINT "resource_services_organization_id_service_id_fkey" FOREIGN KEY ("organization_id", "service_id") REFERENCES "services"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specialists" ADD CONSTRAINT "specialists_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specialists" ADD CONSTRAINT "specialists_organization_id_branch_id_resource_id_fkey" FOREIGN KEY ("organization_id", "branch_id", "resource_id") REFERENCES "resources"("organization_id", "branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specialists" ADD CONSTRAINT "specialists_organization_id_photo_asset_id_fkey" FOREIGN KEY ("organization_id", "photo_asset_id") REFERENCES "media_assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specialist_services" ADD CONSTRAINT "specialist_services_organization_id_specialist_id_fkey" FOREIGN KEY ("organization_id", "specialist_id") REFERENCES "specialists"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specialist_services" ADD CONSTRAINT "specialist_services_organization_id_service_id_fkey" FOREIGN KEY ("organization_id", "service_id") REFERENCES "services"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_organization_id_resource_id_fkey" FOREIGN KEY ("organization_id", "resource_id") REFERENCES "resources"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breaks" ADD CONSTRAINT "breaks_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breaks" ADD CONSTRAINT "breaks_organization_id_resource_id_fkey" FOREIGN KEY ("organization_id", "resource_id") REFERENCES "resources"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_organization_id_resource_id_fkey" FOREIGN KEY ("organization_id", "resource_id") REFERENCES "resources"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_merged_into_id_fkey" FOREIGN KEY ("organization_id", "merged_into_id") REFERENCES "clients"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_consents" ADD CONSTRAINT "client_consents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_consents" ADD CONSTRAINT "client_consents_organization_id_client_id_fkey" FOREIGN KEY ("organization_id", "client_id") REFERENCES "clients"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_consents" ADD CONSTRAINT "client_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_client_id_fkey" FOREIGN KEY ("organization_id", "client_id") REFERENCES "clients"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_organization_id_appointment_id_fkey" FOREIGN KEY ("organization_id", "appointment_id") REFERENCES "appointments"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_organization_id_service_id_fkey" FOREIGN KEY ("organization_id", "service_id") REFERENCES "services"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_organization_id_specialist_id_fkey" FOREIGN KEY ("organization_id", "specialist_id") REFERENCES "specialists"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_resources" ADD CONSTRAINT "appointment_resources_organization_id_appointment_id_fkey" FOREIGN KEY ("organization_id", "appointment_id") REFERENCES "appointments"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_resources" ADD CONSTRAINT "appointment_resources_organization_id_appointment_item_id_fkey" FOREIGN KEY ("organization_id", "appointment_item_id") REFERENCES "appointment_items"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_resources" ADD CONSTRAINT "appointment_resources_organization_id_resource_id_fkey" FOREIGN KEY ("organization_id", "resource_id") REFERENCES "resources"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_organization_id_appointment_id_fkey" FOREIGN KEY ("organization_id", "appointment_id") REFERENCES "appointments"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reschedules" ADD CONSTRAINT "appointment_reschedules_organization_id_appointment_id_fkey" FOREIGN KEY ("organization_id", "appointment_id") REFERENCES "appointments"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_holds" ADD CONSTRAINT "booking_holds_organization_id_appointment_id_fkey" FOREIGN KEY ("organization_id", "appointment_id") REFERENCES "appointments"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_organization_id_client_id_fkey" FOREIGN KEY ("organization_id", "client_id") REFERENCES "clients"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_templates" ADD CONSTRAINT "page_templates_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "page_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_template_versions" ADD CONSTRAINT "page_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "page_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_pages" ADD CONSTRAINT "public_pages_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_pages" ADD CONSTRAINT "public_pages_published_publication_id_fkey" FOREIGN KEY ("published_publication_id") REFERENCES "page_publications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_drafts" ADD CONSTRAINT "page_drafts_organization_id_page_id_fkey" FOREIGN KEY ("organization_id", "page_id") REFERENCES "public_pages"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_drafts" ADD CONSTRAINT "page_drafts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "page_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_drafts" ADD CONSTRAINT "page_drafts_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "page_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_publications" ADD CONSTRAINT "page_publications_organization_id_page_id_fkey" FOREIGN KEY ("organization_id", "page_id") REFERENCES "public_pages"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_publications" ADD CONSTRAINT "page_publications_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "page_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_publications" ADD CONSTRAINT "page_publications_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "page_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_history" ADD CONSTRAINT "page_history_organization_id_page_id_fkey" FOREIGN KEY ("organization_id", "page_id") REFERENCES "public_pages"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_translations" ADD CONSTRAINT "page_translations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "notification_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "notification_outbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_message_statuses" ADD CONSTRAINT "whatsapp_message_statuses_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "notification_outbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_organization_id_appointment_id_fkey" FOREIGN KEY ("organization_id", "appointment_id") REFERENCES "appointments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_organization_id_client_id_fkey" FOREIGN KEY ("organization_id", "client_id") REFERENCES "clients"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_organization_id_promotion_id_fkey" FOREIGN KEY ("organization_id", "promotion_id") REFERENCES "promotions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_organization_id_appointment_id_fkey" FOREIGN KEY ("organization_id", "appointment_id") REFERENCES "appointments"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_organization_id_client_id_fkey" FOREIGN KEY ("organization_id", "client_id") REFERENCES "clients"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_daily_aggregates" ADD CONSTRAINT "analytics_daily_aggregates_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_settings" ADD CONSTRAINT "integration_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
