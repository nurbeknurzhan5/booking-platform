'use client';

import type { ReactNode } from 'react';
import { DashI18nProvider } from '@/lib/i18n-dashboard';
import { StaffGate } from '@/components/dashboard/StaffContext';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashI18nProvider>
      <StaffGate>{children}</StaffGate>
    </DashI18nProvider>
  );
}
