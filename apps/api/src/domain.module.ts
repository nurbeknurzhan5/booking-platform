import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations/organizations.controller';
import { BranchesService } from './organizations/branches.service';
import { StaffService } from './organizations/staff.service';
import { SubscriptionsService } from './subscriptions/subscriptions.service';
import { AdminController } from './admin/admin.controller';
import { AdminOrganizationsService } from './admin/admin-organizations.service';
import { ResourcesController, SchedulesController, ServicesController, SpecialistsController } from './catalog/catalog.controller';
import { ServicesService } from './catalog/services.service';
import { ResourcesService } from './catalog/resources.service';
import { SchedulesService } from './catalog/schedules.service';
import { AvailabilityService } from './booking/availability.service';
import { BookingService } from './booking/booking.service';
import { RemindersService } from './booking/reminders.service';
import { PublicBookingController } from './booking/public-booking.controller';
import { StaffAppointmentsController } from './booking/staff-appointments.controller';
import { WaitlistService } from './booking/waitlist.service';
import { MeWaitlistController, PublicWaitlistController, StaffWaitlistController } from './booking/waitlist.controller';
import { NotificationDispatcher } from './notifications/dispatcher.service';
import { DevInboxChannel, SmsChannel, WhatsAppChannel } from './notifications/channels';
import { WhatsAppWebhookController } from './notifications/whatsapp-webhook.controller';
import { WhatsAppInboundService } from './notifications/whatsapp-inbound.service';
import { ReactivationService } from './notifications/reactivation.service';
import { AdminNotificationsController, DevInboxController, OrgNotificationsController } from './notifications/notifications.controller';
import { JobsService } from './common/jobs.service';
import { AnalyticsService } from './analytics/analytics.service';
import { AnalyticsController } from './analytics/analytics.controller';
import { GoogleTranslateProvider, TranslationService } from './pages/translation.service';
import { ClientsService } from './clients/clients.service';
import { ClientsController } from './clients/clients.controller';
import { MeController } from './clients/me.controller';
import { ReviewsService } from './reviews/reviews.service';
import { ReviewsController } from './reviews/reviews.controller';
import { PromotionsService } from './promotions/promotions.service';
import { PromotionsController } from './promotions/promotions.controller';
import { StorageService } from './files/storage.service';
import { MediaService } from './files/media.service';
import { FilesController } from './files/files.controller';
import { TemplatesService } from './pages/templates.service';
import { PagesService } from './pages/pages.service';
import { PagesController } from './pages/pages.controller';

/** Бизнес-модули платформы (модульный монолит). */
@Module({
  controllers: [
    OrganizationsController,
    AdminController,
    ServicesController,
    SpecialistsController,
    ResourcesController,
    SchedulesController,
    PublicBookingController,
    StaffAppointmentsController,
    PublicWaitlistController,
    StaffWaitlistController,
    MeWaitlistController,
    WhatsAppWebhookController,
    OrgNotificationsController,
    AdminNotificationsController,
    DevInboxController,
    AnalyticsController,
    ClientsController,
    MeController,
    ReviewsController,
    PromotionsController,
    FilesController,
    PagesController,
  ],
  providers: [
    BranchesService,
    StaffService,
    SubscriptionsService,
    AdminOrganizationsService,
    ServicesService,
    ResourcesService,
    SchedulesService,
    AvailabilityService,
    BookingService,
    WaitlistService,
    RemindersService,
    NotificationDispatcher,
    WhatsAppInboundService,
    ReactivationService,
    WhatsAppChannel,
    SmsChannel,
    DevInboxChannel,
    JobsService,
    AnalyticsService,
    GoogleTranslateProvider,
    TranslationService,
    ClientsService,
    ReviewsService,
    PromotionsService,
    StorageService,
    MediaService,
    TemplatesService,
    PagesService,
  ],
  exports: [
    BranchesService,
    SubscriptionsService,
    BookingService,
    WaitlistService,
    RemindersService,
    NotificationDispatcher,
    WhatsAppInboundService,
    ReactivationService,
    AnalyticsService,
    TranslationService,
    JobsService,
  ],
})
export class DomainModule {}
