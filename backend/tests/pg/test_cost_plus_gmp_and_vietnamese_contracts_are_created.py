# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Cost-plus and GMP contracts are created from their terms; a Vietnamese project starts from its law.

On a real database:

* A GMP contract for a US hospital project is created from its cap, target and
  fee, and the gainshare and fee rows its claims and previews read are written
  from the same figures.
* A GMP contract without its figures is refused with a code and the field at
  fault, not with a bare machine word.
* A project whose region reads "Vietnam" gets the Vietnamese payment terms, and
  a contract drawn from a Vietnamese template carries its advance, security and
  warranty terms.
* A compliance run that checks nothing says so.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.core.events import event_bus
from app.modules.contracts.repository import FeeStructureRepository, GainshareConfigurationRepository
from app.modules.contracts.schemas import ContractCreate
from app.modules.contracts.service import ContractsService, compliance_counts, compliance_nothing_checked
from app.modules.contracts.validators import register_contracts_validation_rules
from app.modules.projects.models import Project
from app.modules.users.models import User

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setattr(event_bus, "publish_detached", lambda *a, **k: None)
    register_contracts_validation_rules()


async def _project(session, *, country_code: str | None, region: str = "", currency: str = "USD") -> Project:
    suffix = uuid.uuid4().hex[:8]
    owner = User(id=uuid.uuid4(), email=f"types-{suffix}@site.example", hashed_password="x")
    session.add(owner)
    await session.flush()
    project = Project(
        id=uuid.uuid4(),
        name=f"Contract types {suffix}",
        owner_id=owner.id,
        currency=currency,
        country_code=country_code,
        region=region,
        metadata_={},
    )
    session.add(project)
    await session.flush()
    return project


def _payload(project: Project, **fields) -> ContractCreate:
    return ContractCreate(
        code=f"C-{uuid.uuid4().hex[:8]}",
        project_id=project.id,
        currency=project.currency,
        **fields,
    )


async def test_a_gmp_contract_is_created_with_its_gainshare_and_fee(pg_session) -> None:
    svc = ContractsService(pg_session)
    penn = await _project(pg_session, country_code="US")

    contract = await svc.create_contract(
        _payload(
            penn,
            title="Penn Medicine pavilion - CM at risk",
            contract_type="gmp",
            total_value=Decimal("12000000"),
            template_code="aia_a102_2017",
            terms={"gmp_cap": "12000000", "target_cost": "11500000", "fee_percent": "4"},
        )
    )

    assert contract.contract_type == "gmp"
    assert contract.template_code == "aia_a102_2017"
    gainshare = await GainshareConfigurationRepository(pg_session).get_for_contract(contract.id)
    assert gainshare is not None
    assert gainshare.gmp_cap == Decimal("12000000")
    assert gainshare.target_cost == Decimal("11500000")
    assert gainshare.savings_split_contractor_pct == Decimal("50")
    fee = await FeeStructureRepository(pg_session).get_for_contract(contract.id)
    assert fee is not None
    assert fee.fee_percent == Decimal("4")


async def test_a_cost_plus_contract_bills_the_fee_it_was_created_with(pg_session) -> None:
    svc = ContractsService(pg_session)
    contract = await svc.create_contract(
        _payload(
            await _project(pg_session, country_code="US"),
            contract_type="cost_plus",
            terms={"fee_percent": "7.5", "max_fee": "250000"},
        )
    )
    fee = await FeeStructureRepository(pg_session).get_for_contract(contract.id)
    assert fee is not None
    assert fee.fee_percent == Decimal("7.5")
    assert fee.max_fee == Decimal("250000")


async def test_a_gmp_contract_without_its_figures_names_the_fields(pg_session) -> None:
    svc = ContractsService(pg_session)
    with pytest.raises(HTTPException) as refused:
        await svc.create_contract(_payload(await _project(pg_session, country_code="US"), contract_type="gmp"))

    assert refused.value.status_code == 400
    detail = refused.value.detail
    assert detail["error"] == "invalid_contract_terms"
    assert detail["code"] == "contract_term_required"
    assert {f["field"] for f in detail["fields"]} == {"terms.gmp_cap", "terms.target_cost"}


async def test_a_project_in_the_vietnam_region_starts_from_vietnamese_terms(pg_session) -> None:
    svc = ContractsService(pg_session)
    lego = await _project(pg_session, country_code=None, region="Vietnam", currency="VND")

    defaults = await svc.country_defaults_for_project(lego.id, counterparty_type="client")
    assert defaults["country_code"] == "VN"
    assert defaults["has_defaults"] is True

    contract = await svc.create_contract(
        _payload(lego, contract_type="lump_sum", total_value=Decimal("10000000000000"))
    )
    assert contract.retention_percent == Decimal("5")
    assert contract.terms["payment_terms"]["payment_period_days"] == 14
    assert contract.metadata_["country_defaults"]["country_code"] == "VN"


async def test_a_vietnamese_template_fills_the_advance_security_and_warranty(pg_session) -> None:
    svc = ContractsService(pg_session)
    lego = await _project(pg_session, country_code="VN", currency="VND")

    contract = await svc.create_contract(
        _payload(
            lego,
            contract_type="unit_price",
            total_value=Decimal("8000000000"),
            template_code="vn_nd37_adjustable_unit_price",
            terms={"performance_security_percent": "10"},
        )
    )

    assert contract.terms["price_basis"] == "adjustable"
    assert contract.terms["advance_payment_percent"] == "20"
    assert contract.terms["warranty_period_months"] == "12"
    # What the author sent wins over the template.
    assert contract.terms["performance_security_percent"] == "10"


async def test_a_compliance_run_on_an_empty_schedule_checks_nothing(pg_session) -> None:
    svc = ContractsService(pg_session)
    contract = await svc.create_contract(
        _payload(await _project(pg_session, country_code="VN", currency="VND"), contract_type="lump_sum")
    )
    report, _packs = await svc.run_compliance_gate(contract)

    assert compliance_counts(report)["evaluated"] == 0
    assert compliance_nothing_checked(report) is True
