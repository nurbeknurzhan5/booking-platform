import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations/organizations.controller';
import { BranchesService } from './organizations/branches.service';
import { StaffService } from './organizations/staff.service';
import { SubscriptionsService } from './subscriptions/subscriptions.service';
import { AdminController } from './admin/admin.controller';
import { AdminOrganizationsService } from './admin/admin-organizations.service';

/** Бизнес-модули платформы (модульный монолит). */
@Module({
  controllers: [OrganizationsController, AdminController],
  providers: [BranchesService, StaffService, SubscriptionsService, AdminOrganizationsService],
  exports: [BranchesService, SubscriptionsService],
})
export class DomainModule {}
