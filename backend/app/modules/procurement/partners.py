# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""One partner directory for the purchase-order supplier picker.

A company keeps its business partners in three registers: the contact
directory, the vendor register of the supplier catalogue and the subcontractor
register. A purchase order stores a contact as its vendor, so a supplier that
lived only in the vendor or subcontractor register could not be picked at all,
and a buyer had to keep the same firm in three places.

The contact stays the one identity a purchase order points at. This module
searches the three registers together and, when the buyer picks a register
entry that is not yet linked to a contact, links it: to an existing contact
with the same tax id or the same company name when there is one, otherwise to
a new contact made from the register entry. The link is written on the
register entry (``Vendor.contact_id`` / ``Subcontractor.contact_id``), which
is also what the subcontractor prequalification gate on purchase orders reads,
so the next search finds one partner, not two.

Each register is searched only when the caller may read it, and contacts keep
their owner scope (an administrator sees every contact, anybody else their own,
as the contact directory does).
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterable, Sequence
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.procurement.schemas import (
    POPartner,
    POPartnerListResponse,
    POPartnerResolveResponse,
)

logger = logging.getLogger(__name__)

#: Contact types a resolved register entry is matched against by name.
_PARTNER_CONTACT_TYPES = ("supplier", "subcontractor", "contractor")


def _may(role: str | None, permissions: Iterable[str] | None, permission: str) -> bool:
    normalised = (role or "").strip().lower()
    if normalised == "admin" or permission in set(permissions or ()):
        return True
    from app.core.permissions import permission_registry

    return bool(normalised) and permission_registry.role_has_permission(normalised, permission)


def _contact_name(contact: Any) -> str:
    parts: list[str] = []
    if contact.company_name:
        parts.append(contact.company_name)
    person = " ".join(p for p in (contact.first_name, contact.last_name) if p)
    if person:
        parts.append(person)
    return " - ".join(parts) or (contact.primary_email or str(contact.id))


def _like(q: str) -> str:
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped.lower()}%"


async def search_partners(
    session: AsyncSession,
    *,
    q: str,
    limit: int,
    user_id: str,
    role: str | None,
    permissions: Sequence[str] | None,
) -> POPartnerListResponse:
    """Contacts, vendors and subcontractors matching ``q``, one row per partner.

    A register entry linked to a contact that is already in the result is
    folded into that contact's row (``also_in``) instead of being listed twice.
    An empty ``q`` lists the first ``limit`` of each register by name.
    """
    text = q.strip()
    rows: list[POPartner] = []
    by_contact: dict[str, POPartner] = {}

    def add(row: POPartner) -> None:
        if row.contact_id and row.contact_id in by_contact:
            existing = by_contact[row.contact_id]
            if row.source not in existing.also_in and row.source != existing.source:
                existing.also_in.append(row.source)
            if not existing.code and row.code:
                existing.code = row.code
            return
        rows.append(row)
        if row.contact_id:
            by_contact[row.contact_id] = row

    if _may(role, permissions, "contacts.read"):
        from app.modules.contacts.service import ContactService

        owner = None if (role or "").strip().lower() == "admin" else user_id
        contacts, _total = await ContactService(session).list_contacts(
            search=text or None,
            is_active=True,
            owner_id=owner,
            limit=limit,
            offset=0,
            sort_by="company_name",
            sort_order="asc",
        )
        for c in contacts:
            add(
                POPartner(
                    source="contact",
                    id=str(c.id),
                    contact_id=str(c.id),
                    name=_contact_name(c),
                    contact_type=c.contact_type,
                    tax_id=c.vat_number,
                    country_code=c.country_code,
                )
            )

    if _may(role, permissions, "supplier_catalogs.vendor.read"):
        from app.modules.supplier_catalogs.models import Vendor

        stmt = select(Vendor).where(Vendor.status != "blacklisted")
        if text:
            pattern = _like(text)
            stmt = stmt.where(
                or_(
                    func.lower(Vendor.name).like(pattern, escape="\\"),
                    func.lower(Vendor.code).like(pattern, escape="\\"),
                    func.lower(func.coalesce(Vendor.legal_name, "")).like(pattern, escape="\\"),
                    func.lower(func.coalesce(Vendor.tax_id, "")).like(pattern, escape="\\"),
                )
            )
        for v in (await session.execute(stmt.order_by(Vendor.name).limit(limit))).scalars().all():
            add(
                POPartner(
                    source="vendor",
                    id=str(v.id),
                    contact_id=str(v.contact_id) if v.contact_id else None,
                    name=v.name,
                    code=v.code,
                    contact_type="supplier",
                    tax_id=v.tax_id,
                    country_code=v.country_code,
                )
            )

    if _may(role, permissions, "subcontractors.read"):
        from app.modules.subcontractors.models import Subcontractor

        stmt = select(Subcontractor).where(Subcontractor.is_active.is_(True))
        if text:
            pattern = _like(text)
            stmt = stmt.where(
                or_(
                    func.lower(Subcontractor.legal_name).like(pattern, escape="\\"),
                    func.lower(func.coalesce(Subcontractor.trade_name, "")).like(pattern, escape="\\"),
                    func.lower(func.coalesce(Subcontractor.tax_id, "")).like(pattern, escape="\\"),
                )
            )
        for s in (await session.execute(stmt.order_by(Subcontractor.legal_name).limit(limit))).scalars().all():
            add(
                POPartner(
                    source="subcontractor",
                    id=str(s.id),
                    contact_id=str(s.contact_id) if s.contact_id else None,
                    name=s.trade_name or s.legal_name,
                    contact_type="subcontractor",
                    tax_id=s.tax_id,
                    country_code=s.country,
                )
            )

    return POPartnerListResponse(items=rows, total=len(rows))


async def _existing_contact(session: AsyncSession, contact_id: object) -> Any | None:
    from app.modules.contacts.models import Contact

    try:
        cid = uuid.UUID(str(contact_id))
    except (ValueError, TypeError):
        return None
    contact = await session.get(Contact, cid)
    if contact is None or not contact.is_active:
        return None
    return contact


def _owns_contact(contact: Any, *, user_id: str, role: str | None) -> bool:
    """Whether the caller's contact directory holds ``contact`` (the directory's tenant scope)."""
    if (role or "").strip().lower() == "admin":
        return True
    owner = str(user_id)
    return bool(owner) and owner in {
        str(getattr(contact, "tenant_id", "") or ""),
        str(getattr(contact, "created_by", "") or ""),
    }


async def _matching_contact(session: AsyncSession, *, name: str, tax_id: str | None) -> Any | None:
    """An active partner contact with the same tax id, else the same company name."""
    from app.modules.contacts.models import Contact

    base = select(Contact).where(Contact.is_active.is_(True), Contact.contact_type.in_(_PARTNER_CONTACT_TYPES))
    if tax_id and tax_id.strip():
        hit = (
            (await session.execute(base.where(func.lower(Contact.vat_number) == tax_id.strip().lower()).limit(1)))
            .scalars()
            .first()
        )
        if hit is not None:
            return hit
    if name.strip():
        return (
            (await session.execute(base.where(func.lower(Contact.company_name) == name.strip().lower()).limit(1)))
            .scalars()
            .first()
        )
    return None


async def _contact_for_entry(
    session: AsyncSession,
    *,
    linked_id: object,
    name: str,
    legal_name: str | None,
    tax_id: str | None,
    country: str | None,
    contact_type: str,
    currency: str | None,
    payment_terms_days: int | None,
    user_id: str,
) -> tuple[Any, bool]:
    """The contact a register entry stands for, made when there is none. (contact, created)."""
    linked = await _existing_contact(session, linked_id) if linked_id else None
    if linked is not None:
        return linked, False
    match = await _matching_contact(session, name=name, tax_id=tax_id)
    if match is not None:
        return match, False

    from app.modules.contacts.schemas import ContactCreate
    from app.modules.contacts.service import ContactService

    country_code = (country or "").strip().upper()
    data = ContactCreate(
        contact_type=contact_type,
        company_name=name[:255],
        legal_name=(legal_name or None) and legal_name[:255],
        vat_number=(tax_id or None) and tax_id[:50],
        country_code=country_code if len(country_code) == 2 else None,
        currency_code=(currency or None),
        payment_terms_days=str(payment_terms_days) if payment_terms_days is not None else None,
    )
    contact = await ContactService(session).create_contact(data, user_id=user_id)
    return contact, True


async def resolve_partner(
    session: AsyncSession,
    *,
    source: str,
    partner_id: uuid.UUID,
    user_id: str,
    role: str | None = None,
) -> POPartnerResolveResponse:
    """The contact id a purchase order stores for a picked partner, linking a register entry first.

    A contact picked directly keeps the directory's owner scope: anybody but
    an administrator resolves only their own contacts, and another tenant's
    contact reads as not found, the same answer as one that does not exist.
    """
    if source == "contact":
        contact = await _existing_contact(session, partner_id)
        if contact is None or not _owns_contact(contact, user_id=user_id, role=role):
            raise _not_found(source)
        return POPartnerResolveResponse(contact_id=str(contact.id), name=_contact_name(contact))

    if source == "vendor":
        from app.modules.supplier_catalogs.models import Vendor

        vendor = await session.get(Vendor, partner_id)
        if vendor is None:
            raise _not_found(source)
        contact, created = await _contact_for_entry(
            session,
            linked_id=vendor.contact_id,
            name=vendor.name,
            legal_name=vendor.legal_name,
            tax_id=vendor.tax_id,
            country=vendor.country_code,
            contact_type="supplier",
            currency=vendor.currency,
            payment_terms_days=vendor.payment_terms_days,
            user_id=user_id,
        )
        if str(vendor.contact_id or "") != str(contact.id):
            vendor.contact_id = str(contact.id)
            await session.flush()
        return POPartnerResolveResponse(contact_id=str(contact.id), name=_contact_name(contact), created=created)

    if source == "subcontractor":
        from app.modules.subcontractors.models import Subcontractor

        sub = await session.get(Subcontractor, partner_id)
        if sub is None:
            raise _not_found(source)
        contact, created = await _contact_for_entry(
            session,
            linked_id=sub.contact_id,
            name=sub.trade_name or sub.legal_name,
            legal_name=sub.legal_name,
            tax_id=sub.tax_id,
            country=sub.country,
            contact_type="subcontractor",
            currency=None,
            payment_terms_days=None,
            user_id=user_id,
        )
        if sub.contact_id != contact.id:
            sub.contact_id = contact.id
            await session.flush()
        return POPartnerResolveResponse(contact_id=str(contact.id), name=_contact_name(contact), created=created)

    raise _not_found(source)


def _not_found(source: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={
            "code": "po_partner_not_found",
            "message": "The selected partner no longer exists. Search again and pick another.",
            "field": "vendor_contact_id",
            "params": {"source": source},
        },
    )
