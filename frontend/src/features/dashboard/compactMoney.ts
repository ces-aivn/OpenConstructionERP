// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Compact money for headline tiles, readable in Vietnamese.
 *
 * The formatter lives with the other money helpers so every compact amount
 * (tiles, project cards, `MoneyDisplay compact`) spells the Vietnamese scale
 * words the same way; this module keeps the dashboard's import path.
 */
export { formatCompactMoney } from '@/shared/lib/money';
