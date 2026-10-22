# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Boot-path data repairs owned by the supplier catalogue module.

Imported by :func:`app.core.data_repairs.discover_data_repairs`; nothing else
imports this file.

The demo seed (``seed.py``) writes five German sample vendors in EUR, a
hundred numbered catalogue items, a category tree, a warehouse with stock and
a handful of requisitions, orders, receipts and invoices. The vendor register
and the catalogue are company-wide, so those rows sit beside the tenant's real
suppliers. They belong to the demo while a demo project is installed; once
the last one is removed (the demo purge deletes projects and nothing else)
they are leftovers that a real company reads as its own data.

This repair removes them, and only them:

* nothing happens while any live demo project exists;
* a row is the seed's when it matches the seed's own constants on several
  fields at once (code, name, currency, country, numbering), never on one;
* a seeded vendor somebody has used is kept: one edited well after it was
  written, linked to a contact, named on a requisition (or a requisition
  line's BOQ source), a bidder list, a framework agreement, the plant
  register or a site media connection, or holding an order or invoice that
  is not the seed's;
* a category is the seed's only with the seed's code, name and level and no
  later edit; a seeded catalogue item or category still referenced by
  anything that remains is kept.

Idempotent: a second pass finds nothing and returns 0.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.data_repairs import DataRepair, register_data_repair

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


async def _run_remove_demo_leftovers(session: AsyncSession) -> int:
    """Delete the demo seed's supplier-catalogue rows when no demo project is installed.

    Imported inside the function so that importing this module costs only the
    registration.
    """
    from app.modules.supplier_catalogs.demo_leftovers import remove_demo_supplier_catalogue

    return await remove_demo_supplier_catalogue(session)


#: Nature ``always_wrong``: these rows were never the tenant's data; they were
#: demo content that outlived the demo projects it was written for.
SUPPLIER_CATALOGS_DEMO_LEFTOVERS = register_data_repair(
    DataRepair(
        repair_id="supplier_catalogs_remove_demo_leftovers",
        revision="",
        summary="Remove the demo seed's sample vendors and catalogue once no demo project is installed",
        run=_run_remove_demo_leftovers,
        nature="always_wrong",
    )
)
