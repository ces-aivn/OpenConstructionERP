# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Contacts service - business logic for contact management.

Stateless service layer. Handles:
- Contact CRUD
- Search across name, company, email
- Soft-delete (deactivate)
- Email format validation and duplicate detection
"""

import logging
import re
import uuid
from datetime import UTC, date, datetime

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.json_merge import merge_metadata
from app.modules.contacts.models import Contact
from app.modules.contacts.repository import ContactRepository
from app.modules.contacts.schemas import ContactCreate, ContactUpdate

logger = logging.getLogger(__name__)
_logger_audit = logging.getLogger(__name__ + ".audit")

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ── Prequalification needs insurance ──────────────────────────────────────
#
# The same rule the subcontractor register applies: a party's prequalification
# is not approved while it holds no valid insurance, unless whoever approves it
# states why. The machine code is shared with the subcontractor refusal so the
# UI translates both under one ``api_errors.<code>`` key.
PREQUAL_NEEDS_INSURANCE_CODE = "prequal_approval_needs_insurance"
PREQUAL_OVERRIDE_METADATA_KEY = "prequal_approval_override"
_INSURANCE_EXPIRY_KEYS = ("expiry_date", "valid_until", "expires_at", "expires_on", "expiry", "end_date")
_INSURANCE_DEAD_STATES = frozenset({"expired", "revoked", "cancelled", "canceled", "lapsed", "void"})


def _parse_day(raw: object) -> date | None:
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        return date.fromisoformat(raw.strip()[:10])
    except ValueError:
        return None


def contact_insurance_state(insurance: object, *, as_at: date) -> str:
    """Whether a contact is insured on ``as_at``: ``valid``, ``expired`` or ``missing``.

    ``insurance`` is the free-form list kept on the contact. An entry counts as
    cover when it is not marked dead and its expiry date (under any of the
    usual keys) is not before ``as_at``; an entry with no expiry date is cover
    on file. A plain non-empty string entry (a policy reference) is cover too.
    """
    if not isinstance(insurance, list) or not insurance:
        return "missing"
    saw_expired = False
    for entry in insurance:
        if isinstance(entry, str):
            if entry.strip():
                return "valid"
            continue
        if not isinstance(entry, dict) or not entry:
            continue
        state = str(entry.get("status") or entry.get("state") or "").strip().lower()
        if state in _INSURANCE_DEAD_STATES:
            saw_expired = True
            continue
        expiry = next((_parse_day(entry.get(k)) for k in _INSURANCE_EXPIRY_KEYS if entry.get(k)), None)
        if expiry is not None and expiry < as_at:
            saw_expired = True
            continue
        return "valid"
    return "expired" if saw_expired else "missing"


def contact_prequal_override(
    insurance: object,
    override_reason: str | None,
    *,
    actor_id: str | None,
    as_at: date | None = None,
) -> dict | None:
    """Allow an approval, refuse it, or record why it was allowed without insurance.

    Returns ``None`` when the contact is insured. Without insurance a stated
    reason is required: with one, the record of who approved, when, why and the
    insurance state is returned for the contact's metadata; without one a 422
    with a stable code and the field to fill is raised.
    """
    state = contact_insurance_state(insurance, as_at=as_at or date.today())
    if state == "valid":
        return None
    reason = (override_reason or "").strip()
    if not reason:
        raise HTTPException(
            status_code=422,
            detail={
                "code": PREQUAL_NEEDS_INSURANCE_CODE,
                "error": PREQUAL_NEEDS_INSURANCE_CODE,
                "field": "prequal_override_reason",
                "params": {"insurance_state": state},
                "message": (
                    "This contact has no valid insurance on file, so prequalification cannot be "
                    "approved. Record a valid insurance, or state the reason for approving without one."
                ),
            },
        )
    return {
        "reason": reason,
        "insurance_state": state,
        "by": actor_id,
        "at": datetime.now(UTC).isoformat(),
    }


# ── PII safety ─────────────────────────────────────────────────────────────
# Logs are routinely shipped off-host (CloudWatch / Loki / Sentry / journald
# tail). GDPR Art. 5(1)(c) "data minimisation" means raw e-mail / phone /
# full name must not flow into application logs by default. Redact before
# formatting any log line that interpolates a contact attribute.


def _redact_email(email: str | None) -> str:
    """Return ``j***@example.com`` so support can still triage by domain."""
    if not email or "@" not in email:
        return "<redacted>"
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}" if local else f"***@{domain}"


def _safe_label(
    *,
    company_name: str | None,
    first_name: str | None,
    last_name: str | None,
) -> str:
    """Build a log-safe label from the most-public attribute available.

    Falls back to initials-only when no company is set - full personal
    names should never hit the log stream verbatim.
    """
    if company_name:
        return company_name
    initials = "".join(p[:1] for p in (first_name, last_name) if p)
    return f"<person:{initials or '?'}>"


async def _safe_audit(
    session: AsyncSession,
    *,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    user_id: str | None = None,
    details: dict | None = None,
) -> None:
    """Best-effort audit log - never blocks the caller on failure."""
    try:
        from app.core.audit import audit_log

        await audit_log(
            session,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            user_id=user_id,
            details=details,
        )
    except Exception:
        _logger_audit.debug("Audit log write skipped for %s %s", action, entity_type)


def _validate_email_format(email: str | None) -> None:
    """Validate email format. Raises 400 if invalid."""
    if email is not None and not _EMAIL_RE.match(email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid email format: {email}",
        )


class ContactService:
    """Business logic for contact operations."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = ContactRepository(session)

    # ── Create ────────────────────────────────────────────────────────────

    async def create_contact(
        self,
        data: ContactCreate,
        user_id: str | None = None,
    ) -> Contact:
        """Create a new contact.

        Validates email format and checks for duplicate emails among active contacts.
        """
        # Validate email format
        _validate_email_format(data.primary_email)

        # Check for duplicate email among active contacts
        normalised_email = data.primary_email.lower() if data.primary_email else None
        if normalised_email:
            existing = await self.repo.get_by_email(normalised_email)
            if existing is not None and existing.is_active:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(f"A contact with email '{normalised_email}' already exists (id={existing.id})."),
                )

        metadata = dict(data.metadata or {})
        if data.prequalification_status == "approved":
            override = contact_prequal_override(
                data.insurance, data.prequal_override_reason, actor_id=user_id
            )
            if override is not None:
                metadata[PREQUAL_OVERRIDE_METADATA_KEY] = override

        contact = Contact(
            contact_type=data.contact_type,
            is_platform_user=data.is_platform_user,
            user_id=data.user_id,
            first_name=data.first_name,
            last_name=data.last_name,
            company_name=data.company_name,
            legal_name=data.legal_name,
            party_kind=data.party_kind,
            vat_number=data.vat_number,
            tax_office=data.tax_office,
            country_code=data.country_code,
            address=data.address,
            primary_email=normalised_email,
            primary_phone=data.primary_phone,
            website=data.website,
            certifications=data.certifications,
            insurance=data.insurance,
            prequalification_status=data.prequalification_status,
            qualified_until=data.qualified_until,
            payment_terms_days=data.payment_terms_days,
            currency_code=data.currency_code,
            name_translations=data.name_translations,
            notes=data.notes,
            # ``tenant_id`` is the access gate. For single-tenant installs
            # it equals the creator's user id so new contacts stay
            # siloed per user. ``created_by`` stays as the audit field.
            tenant_id=user_id,
            created_by=user_id,
            metadata_=metadata,
        )
        try:
            contact = await self.repo.create(contact)
        except IntegrityError:
            # Two concurrent POSTs both passed the read-then-write check
            # above and raced into the INSERT. If the deployment runs the
            # ``ix_oe_contacts_contact_primary_email_unique_active`` partial
            # index (or equivalent UNIQUE constraint), one INSERT wins and
            # the other surfaces here. Translate to 409 instead of 500.
            await self.session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A contact with this email already exists.",
            ) from None

        label = _safe_label(
            company_name=data.company_name,
            first_name=data.first_name,
            last_name=data.last_name,
        )

        # Audit ``details`` survive into the audit table and may be reviewed
        # by support staff - keep the same PII-minimising rule that applies
        # to the log line. The full contact remains queryable by ``entity_id``
        # for an authorised operator who actually needs the row.
        await _safe_audit(
            self.session,
            action="create",
            entity_type="contact",
            entity_id=str(contact.id),
            user_id=user_id,
            details={"label": label, "contact_type": data.contact_type},
        )

        logger.info("Contact created: %s (%s)", label, data.contact_type)
        return contact

    # ── Read ──────────────────────────────────────────────────────────────

    async def get_contact(self, contact_id: uuid.UUID) -> Contact:
        """Get contact by ID. Raises 404 if not found."""
        contact = await self.repo.get(contact_id)
        if contact is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Contact not found",
            )
        return contact

    async def get_by_email(self, email: str) -> Contact | None:
        """Get contact by primary email."""
        return await self.repo.get_by_email(email)

    async def list_contacts(
        self,
        *,
        contact_type: str | None = None,
        country_code: str | None = None,
        search: str | None = None,
        is_active: bool = True,
        owner_id: str | None = None,
        tags: list[str] | None = None,
        limit: int = 50,
        offset: int = 0,
        sort_by: str | None = None,
        sort_order: str = "desc",
    ) -> tuple[list[Contact], int]:
        """List contacts with filters.

        ``owner_id`` scopes the result by the caller's ``tenant_id``
        (with a ``created_by`` fallback for rows that existed before
        the v2.3.1 backfill). Pass ``None`` to opt out of the scope
        filter - only admin callers should do that.
        """
        return await self.repo.list(
            contact_type=contact_type,
            country_code=country_code,
            search=search,
            is_active=is_active,
            owner_id=owner_id,
            tags=tags,
            limit=limit,
            offset=offset,
            sort_by=sort_by,
            sort_order=sort_order,
        )

    async def tag_facets(
        self,
        *,
        owner_id: str | None = None,
        limit: int = 60,
    ) -> list[tuple[str, int]]:
        """Return top tags with counts from active contacts."""
        return await self.repo.tag_facets(owner_id=owner_id, limit=limit)

    # ── Update ────────────────────────────────────────────────────────────

    async def update_contact(
        self,
        contact_id: uuid.UUID,
        data: ContactUpdate,
        user_id: str | None = None,
    ) -> Contact:
        """Update contact fields.

        Validates email format and checks for duplicate emails on update.
        ``user_id`` is the authenticated caller - recorded in the audit
        row so PATCH events are attributable just like create/delete.
        Earlier revisions of this method dropped the caller id, leaving
        the audit table with ``user_id=NULL`` for every update.
        """
        contact = await self.get_contact(contact_id)

        fields = data.model_dump(exclude_unset=True)
        override_reason = fields.pop("prequal_override_reason", None)
        # Approving prequalification (from any other state) needs insurance on
        # the contact as it will stand after this update, or a stated reason.
        override: dict | None = None
        if fields.get("prequalification_status") == "approved" and contact.prequalification_status != "approved":
            insurance_after = fields.get("insurance", contact.insurance)
            override = contact_prequal_override(insurance_after, override_reason, actor_id=user_id)
        # Merge a partial metadata patch into the existing column instead of
        # replacing it wholesale, so a PATCH touching one key keeps the rest
        # (tags, internal notes, etc.).
        if "metadata" in fields:
            incoming_meta = fields.pop("metadata")
            if isinstance(incoming_meta, dict):
                fields["metadata_"] = merge_metadata(getattr(contact, "metadata_", None), incoming_meta)
            else:
                fields["metadata_"] = incoming_meta

        if override is not None:
            base_meta = fields.get("metadata_", getattr(contact, "metadata_", None))
            fields["metadata_"] = merge_metadata(base_meta, {PREQUAL_OVERRIDE_METADATA_KEY: override})

        # Validate and normalise email if being updated
        if "primary_email" in fields and fields["primary_email"] is not None:
            _validate_email_format(fields["primary_email"])
            fields["primary_email"] = fields["primary_email"].lower()

            # Check for duplicate email (skip if it's the same contact)
            existing = await self.repo.get_by_email(fields["primary_email"])
            if existing is not None and existing.id != contact_id and existing.is_active:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(f"A contact with email '{fields['primary_email']}' already exists (id={existing.id})."),
                )
        elif "primary_email" in fields:
            # Explicitly setting to None is OK (clearing the email)
            pass

        if not fields:
            return contact

        try:
            await self.repo.update(contact_id, **fields)
        except IntegrityError:
            await self.session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A contact with this email already exists.",
            ) from None
        updated = await self.repo.get(contact_id)
        if updated is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Contact not found",
            )

        await _safe_audit(
            self.session,
            action="update",
            entity_type="contact",
            entity_id=str(contact_id),
            user_id=user_id,
            details={"updated_fields": list(fields.keys())},
        )

        logger.info("Contact updated: %s (fields=%s)", contact_id, list(fields.keys()))
        return updated

    # ── Soft delete ───────────────────────────────────────────────────────

    async def deactivate_contact(
        self,
        contact_id: uuid.UUID,
        user_id: str | None = None,
    ) -> None:
        """Soft-delete a contact (set is_active=False)."""
        await self.get_contact(contact_id)  # Raises 404 if not found
        await self.repo.update(contact_id, is_active=False)
        await _safe_audit(
            self.session,
            action="delete",
            entity_type="contact",
            entity_id=str(contact_id),
            user_id=user_id,
            details={},
        )

        logger.info("Contact deactivated: %s", contact_id)

    # ── Count ─────────────────────────────────────────────────────────────

    async def count_contacts(self, contact_type: str | None = None) -> int:
        """Count contacts, optionally by type."""
        return await self.repo.count(contact_type=contact_type)

    # ── Stats ────────────────────────────────────────────────────────────

    async def get_stats(self, *, owner_id: str | None = None) -> dict:
        """Return aggregate contact statistics.

        ``owner_id`` scopes the aggregates to the caller's contacts;
        ``None`` is the global view (admin-only).
        """
        return await self.repo.stats(owner_id=owner_id)

    # ── By Company ───────────────────────────────────────────────────────

    async def list_by_company(
        self,
        company_name: str,
        *,
        owner_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Contact], int]:
        """List contacts grouped by company name.

        ``owner_id`` scopes the result by ``tenant_id`` (with a
        ``created_by`` fallback for pre-v2.3.1 rows).
        """
        return await self.repo.list_by_company(
            company_name,
            owner_id=owner_id,
            limit=limit,
            offset=offset,
        )
