import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { CalendarClock, FileSpreadsheet, FolderOpen } from 'lucide-react';
import { BrandWordmark, BRAND_LOGO_URL, BRAND_TEAL } from '@/shared/ui';

/** Desktop-only brand column of the sign-in and sign-up pages. */
export function AuthBrandPanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const features = [
    { icon: FileSpreadsheet, label: t('login.cescons_feat_estimate', { defaultValue: 'Estimates and bills of quantities' }) },
    { icon: CalendarClock, label: t('login.cescons_feat_schedule', { defaultValue: 'Schedule, cost and progress tracking' }) },
    { icon: FolderOpen, label: t('login.cescons_feat_documents', { defaultValue: 'Project documents in one place' }) },
  ];
  return (
    <div className={clsx('hidden lg:flex relative z-10 flex-col justify-center px-14 xl:px-20 py-6 overflow-hidden', className)}>
      <div
        className="absolute inset-0 pointer-events-none -z-10"
        aria-hidden
        style={{
          background:
            'radial-gradient(ellipse 90% 70% at 70% 25%, rgba(1,151,178,0.14), transparent 65%),' +
            'radial-gradient(ellipse 80% 60% at 25% 85%, rgba(13,41,104,0.10), transparent 65%)',
        }}
      />
      <div className="max-w-[460px] animate-stagger-in">
        {/* The logo has no dark variant, so it always sits on white. */}
        <div className="inline-block rounded-2xl bg-white px-5 py-4 shadow-sm">
          <img src={BRAND_LOGO_URL} alt="CES Global" className="block h-16 w-auto" draggable={false} />
        </div>
        <h2 className="mt-8 text-[34px] font-semibold leading-[1.1]">
          <BrandWordmark />
        </h2>
        <p className="mt-3 text-[17px] text-content-secondary leading-[1.6]">
          {t('login.cescons_tagline', { defaultValue: 'Construction project management for Vietnamese and US businesses.' })}
        </p>
        <ul className="mt-6 space-y-3">
          {features.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-3 text-[15px] text-content-primary">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ background: 'rgba(1,151,178,0.10)', color: BRAND_TEAL }}
              >
                <Icon size={16} strokeWidth={1.9} />
              </span>
              {label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
