// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The page index behind the command palette (Cmd/Ctrl+K).
//
// The palette used to carry its own short list of eighteen screens and matched
// the query against the label in the reader's language only. Contracts and the
// risk register were not in that list at all, and "BOQ" found only the "New
// BOQ" action because the Vietnamese page title is "Bảng khối lượng". The
// index is now the sidebar catalogue itself, and each screen is matched on its
// label in the reader's language, its English label and a short list of
// synonyms in both languages, compared without tone marks so "hop dong" finds
// "Hợp đồng".

import type { LucideIcon } from 'lucide-react';
import { navGroups, type NavItem } from '@/app/layout/navCatalog';

/** One screen the palette can open. */
export interface PageIndexEntry {
  id: string;
  labelKey: string;
  defaultLabel?: string;
  path: string;
  icon: LucideIcon;
  moduleKey?: string;
  adminOnly?: boolean;
  roleGate?: NavItem['roleGate'];
}

/** Lower-case, drop diacritics (Vietnamese tone marks, đ) and collapse
 *  whitespace, so a query typed with or without accents compares equal. */
export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extra words a reader may type for a screen, in English and Vietnamese.
 *  Keyed by the route path the sidebar uses. The translated labels are
 *  matched as well, so only words that differ from both labels belong here. */
export const PAGE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  '/': ['dashboard', 'bảng điều khiển', 'tổng quan', 'home'],
  '/projects': ['project', 'projects', 'dự án'],
  '/boq': ['boq', 'bill of quantities', 'bảng khối lượng', 'bảng tiên lượng', 'dự toán', 'estimate'],
  '/costs': ['cost database', 'rates', 'cơ sở dữ liệu chi phí', 'csdl chi phí', 'đơn giá', 'định mức'],
  '/catalog': ['resource catalog', 'resources', 'danh mục nguồn lực', 'nguồn lực', 'vật tư', 'nhân công', 'máy thi công'],
  '/contracts': ['contract', 'contracts', 'hợp đồng'],
  '/risks': ['risk', 'risks', 'risk register', 'rủi ro', 'sổ rủi ro', 'monte carlo'],
  '/schedule': ['schedule', 'gantt', 'tiến độ', 'lịch', 'đường găng', 'critical path', '4d'],
  '/tasks': ['task', 'tasks', 'công việc', 'nhiệm vụ'],
  '/changeorders': ['change order', 'change orders', 'lệnh thay đổi'],
  '/variations': ['variation', 'variations', 'phát sinh'],
  '/rfi': ['rfi', 'request for information', 'yêu cầu thông tin'],
  '/submittals': ['submittal', 'submittals', 'hồ sơ trình duyệt', 'trình duyệt'],
  '/finance': ['finance', 'invoice', 'payment', 'tài chính', 'hóa đơn', 'thanh toán', 'công nợ'],
  '/cost-control': ['cost control', 'budget', 'kiểm soát chi phí', 'ngân sách'],
  '/5d': ['5d', 'budget', 'ngân sách 5d', 'mô hình chi phí'],
  '/full-evm': ['evm', 'earned value', 'giá trị thu được'],
  '/tendering': ['tender', 'bid', 'đấu thầu', 'gói thầu'],
  '/procurement': ['procurement', 'purchase order', 'mua sắm', 'đơn đặt hàng'],
  '/subcontractors': ['subcontractor', 'subcontractors', 'nhà thầu phụ'],
  '/reports': ['report', 'reports', 'báo cáo', 'biểu mẫu', 'g702', 'g703', '03a'],
  '/ncr': ['ncr', 'non-conformance', 'không phù hợp', 'báo cáo không phù hợp'],
  '/punchlist': ['punch list', 'snag', 'danh sách sửa chữa', 'tồn tại'],
  '/inspections': ['inspection', 'inspections', 'kiểm tra', 'nghiệm thu'],
  '/daily-diary': ['daily diary', 'site diary', 'nhật ký thi công', 'nhật ký công trường'],
  '/safety': ['safety', 'hse', 'an toàn'],
  '/meetings': ['meeting', 'meetings', 'cuộc họp', 'biên bản họp'],
  '/correspondence': ['correspondence', 'letter', 'công văn', 'thư từ'],
  '/files': ['document', 'documents', 'files', 'tài liệu', 'hồ sơ'],
  '/contacts': ['contact', 'contacts', 'danh bạ', 'liên hệ'],
  '/progress': ['progress', 'tiến độ thực hiện', 'khối lượng hoàn thành'],
  '/validation': ['validation', 'kiểm tra hợp lệ', 'xác thực'],
};

/** Every screen in the sidebar catalogue, once, in sidebar order. */
export function buildPageIndex(groups = navGroups): PageIndexEntry[] {
  const seen = new Set<string>();
  const out: PageIndexEntry[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      if (seen.has(item.to)) continue;
      seen.add(item.to);
      out.push({
        id: `page-${item.to}`,
        labelKey: item.labelKey,
        defaultLabel: item.defaultLabel,
        path: item.to,
        icon: item.icon,
        moduleKey: item.moduleKey,
        adminOnly: item.adminOnly,
        roleGate: item.roleGate,
      });
    }
  }
  return out;
}

/** The base route of a palette path, without its query string. */
function basePath(path: string): string {
  const q = path.indexOf('?');
  return q === -1 ? path : path.slice(0, q);
}

/**
 * How well a screen answers a query: 0 for no match, higher is better.
 *
 * `labels` are the screen's display names (reader's language first, then
 * English). An exact label or keyword ranks above a prefix, a prefix above
 * a substring, so "BOQ" puts the Bill of Quantities page above "New BOQ".
 */
export function scorePage(entry: PageIndexEntry, labels: readonly string[], query: string): number {
  const needle = normalizeSearchText(query);
  if (!needle) return 0;
  const keywords = PAGE_KEYWORDS[basePath(entry.path)] ?? [];
  let best = 0;
  for (const raw of [...labels, ...keywords]) {
    const hay = normalizeSearchText(raw);
    if (!hay) continue;
    if (hay === needle) best = Math.max(best, 4);
    else if (hay.startsWith(needle)) best = Math.max(best, 3);
    else if (hay.split(' ').some((word) => word.startsWith(needle))) best = Math.max(best, 2);
    else if (hay.includes(needle)) best = Math.max(best, 1);
  }
  return best;
}
