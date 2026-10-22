import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

/** Public repository holding the source this deployment is built from. */
export const SOURCE_CODE_URL = 'https://github.com/ces-aivn/OpenConstructionERP';

/**
 * AGPL-3.0 section 13 notice: users reaching the app over a network are
 * offered its source. CesCons is built on OpenConstructionERP.
 */
export function SourceNotice({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={clsx('text-center text-2xs text-content-quaternary', className)}>
      {t('brand.based_on', { defaultValue: 'Based on OpenConstructionERP' })}
      <span className="mx-1.5 opacity-50">·</span>
      <a
        href={SOURCE_CODE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-content-secondary transition-colors"
      >
        {t('brand.source_code', { defaultValue: 'AGPL-3.0 source code' })}
      </a>
    </p>
  );
}
