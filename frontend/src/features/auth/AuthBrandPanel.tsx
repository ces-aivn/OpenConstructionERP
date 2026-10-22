import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { BRAND_LOGO_URL } from '@/shared/ui';

/**
 * Desktop-only brand column of the sign-in and sign-up pages: a solid CES navy
 * panel with the logo, one claim and the three things the product does.
 */
export function AuthBrandPanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const features = [
    t('login.cescons_feat_estimate', { defaultValue: 'Estimates and bills of quantities' }),
    t('login.cescons_feat_schedule', { defaultValue: 'Schedule, cost and progress tracking' }),
    t('login.cescons_feat_documents', { defaultValue: 'Project documents in one place' }),
  ];
  return (
    <div
      className={clsx(
        'hidden lg:flex relative z-10 flex-col justify-between bg-[var(--oe-navy)] px-14 xl:px-20 py-12 text-white',
        className,
      )}
    >
      {/* The logo has no light-on-dark variant, so it sits on a white plate. */}
      <div className="inline-flex self-start rounded-md bg-white px-4 py-3">
        <img src={BRAND_LOGO_URL} alt="CES Global" className="block h-11 w-auto" draggable={false} />
      </div>

      <div className="max-w-[460px]">
        <p className="text-balance text-[30px] font-semibold leading-[1.2] text-white">
          {t('login.cescons_tagline', {
            defaultValue: 'Construction project management for Vietnamese and US businesses.',
          })}
        </p>
        <ul className="mt-8 divide-y divide-white/15 border-y border-white/15">
          {features.map((label, i) => (
            <li key={label} className="flex items-baseline gap-4 py-3.5 text-[15px] text-white/90">
              <span className="w-6 shrink-0 font-mono text-xs tabular-nums text-[#7dd3e3]">
                {String(i + 1).padStart(2, '0')}
              </span>
              {label}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-white/60">© CES Global</p>
    </div>
  );
}
