"""One partner directory behind the purchase-order supplier picker.

A firm kept as a contact, as a vendor of the supplier register or as a
subcontractor can be ordered from. Picking a register entry that has no
contact yet links it to one, so the next search shows one partner, not two.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.contacts.models import Contact
from app.modules.procurement.partners import resolve_partner, search_partners
from app.modules.subcontractors.models import Subcontractor
from app.modules.supplier_catalogs.models import Vendor
from tests._pg import transactional_session

USER = str(uuid.uuid4())


@pytest_asyncio.fixture
async def session() -> AsyncSession:
    async with transactional_session(disable_fks=True) as s:
        yield s


async def _registers(session: AsyncSession, tag: str) -> tuple[Contact, Vendor, Subcontractor]:
    contact = Contact(
        contact_type="supplier",
        company_name=f"Thep Viet {tag}",
        vat_number=f"0101{tag}",
        tenant_id=USER,
        created_by=USER,
        is_active=True,
    )
    vendor = Vendor(code=f"NCC-{tag}", name=f"Xi mang Ha Tien {tag}", currency="VND", country_code="VN")
    sub = Subcontractor(legal_name=f"Cong ty Dien Nuoc {tag}", tax_id=f"0309{tag}", country="VN", is_active=True)
    session.add_all([contact, vendor, sub])
    await session.flush()
    return contact, vendor, sub


@pytest.mark.asyncio
async def test_search_finds_all_three_registers(session: AsyncSession) -> None:
    tag = uuid.uuid4().hex[:6]
    contact, vendor, sub = await _registers(session, tag)
    result = await search_partners(session, q=tag, limit=20, user_id=USER, role="admin", permissions=[])
    by_source = {row.source: row for row in result.items}
    assert by_source["contact"].contact_id == str(contact.id)
    assert by_source["vendor"].id == str(vendor.id)
    assert by_source["vendor"].contact_id is None
    assert by_source["subcontractor"].id == str(sub.id)


@pytest.mark.asyncio
async def test_resolving_a_vendor_links_it_to_a_new_contact_once(session: AsyncSession) -> None:
    tag = uuid.uuid4().hex[:6]
    _contact, vendor, _sub = await _registers(session, tag)
    first = await resolve_partner(session, source="vendor", partner_id=vendor.id, user_id=USER)
    assert first.created is True
    assert vendor.contact_id == first.contact_id
    created = await session.get(Contact, uuid.UUID(first.contact_id))
    assert created is not None and created.contact_type == "supplier"
    assert created.currency_code == "VND"

    again = await resolve_partner(session, source="vendor", partner_id=vendor.id, user_id=USER)
    assert again.contact_id == first.contact_id
    assert again.created is False

    # The vendor now folds into its contact's row instead of being listed twice.
    result = await search_partners(session, q=tag, limit=20, user_id=USER, role="admin", permissions=[])
    rows = [r for r in result.items if r.contact_id == first.contact_id]
    assert len(rows) == 1
    assert rows[0].source == "contact" and "vendor" in rows[0].also_in


@pytest.mark.asyncio
async def test_resolving_a_subcontractor_reuses_the_contact_with_its_tax_id(session: AsyncSession) -> None:
    tag = uuid.uuid4().hex[:6]
    contact, _vendor, sub = await _registers(session, tag)
    contact.vat_number = sub.tax_id
    await session.flush()
    resolved = await resolve_partner(session, source="subcontractor", partner_id=sub.id, user_id=USER)
    assert resolved.contact_id == str(contact.id)
    assert resolved.created is False
    assert sub.contact_id == contact.id


@pytest.mark.asyncio
async def test_unknown_partner_is_a_coded_404(session: AsyncSession) -> None:
    with pytest.raises(HTTPException) as exc:
        await resolve_partner(session, source="vendor", partner_id=uuid.uuid4(), user_id=USER)
    assert exc.value.status_code == 404
    assert exc.value.detail["code"] == "po_partner_not_found"  # type: ignore[index]


@pytest.mark.asyncio
async def test_a_caller_without_register_rights_sees_only_what_they_may_read(session: AsyncSession) -> None:
    from app.modules.contacts.permissions import register_contacts_permissions
    from app.modules.subcontractors.permissions import register_subcontractors_permissions
    from app.modules.supplier_catalogs.permissions import register_supplier_catalogs_permissions

    # The three registers' rights as an install has them, so the outcome does
    # not depend on which modules another test happened to load. A viewer may
    # read both registers there; a field worker granted only the contact
    # directory may not.
    register_contacts_permissions()
    register_subcontractors_permissions()
    register_supplier_catalogs_permissions()
    tag = uuid.uuid4().hex[:6]
    await _registers(session, tag)
    result = await search_partners(
        session, q=tag, limit=20, user_id=USER, role="field_worker", permissions=["contacts.read"]
    )
    assert {r.source for r in result.items} == {"contact"}


@pytest.mark.asyncio
async def test_a_contact_is_resolved_only_from_the_callers_own_directory(session: AsyncSession) -> None:
    contact, _vendor, _sub = await _registers(session, uuid.uuid4().hex[:6])

    own = await resolve_partner(session, source="contact", partner_id=contact.id, user_id=USER, role="editor")
    assert own.contact_id == str(contact.id)

    with pytest.raises(HTTPException) as exc:
        await resolve_partner(
            session, source="contact", partner_id=contact.id, user_id=str(uuid.uuid4()), role="editor"
        )
    assert exc.value.status_code == 404
    assert exc.value.detail["code"] == "po_partner_not_found"  # type: ignore[index]

    admin = await resolve_partner(
        session, source="contact", partner_id=contact.id, user_id=str(uuid.uuid4()), role="admin"
    )
    assert admin.contact_id == str(contact.id)
