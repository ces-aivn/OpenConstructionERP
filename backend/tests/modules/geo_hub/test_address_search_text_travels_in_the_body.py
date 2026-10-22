# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""An address search can travel in the request body.

A site address is often a private home. On the ``GET`` query string it is
kept by every proxy and access log on the way; ``POST /geocode/suggest``
carries it in the body and answers exactly like the ``GET`` form, including
the empty, disabled answer when addresses may not leave the server.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.modules.geo_hub import geocoder as geocoder_mod
from app.modules.geo_hub.geocoder import SuggestionResult

URL = "/api/v1/geo-hub/geocode/suggest"


@pytest.fixture
def seen_queries(monkeypatch):
    seen: list[str] = []

    async def fake(q, *, limit: int = 5, **_kwargs):
        seen.append(q)
        return [
            SuggestionResult(
                display_name=f"{q} {i}, Việt Nam",
                lat=Decimal("21.0285"),
                lon=Decimal("105.8542"),
                country_code="vn",
                bbox=None,
                addresstype="road",
                osm_type="way",
            )
            for i in range(min(limit, 2))
        ]

    monkeypatch.setattr(geocoder_mod, "suggest_addresses", fake)
    return seen


@pytest.mark.asyncio
async def test_post_answers_like_get(http_client, tenant_a, seen_queries):
    res = await http_client.post(URL, json={"q": "12 Tràng Tiền", "limit": 2}, headers=tenant_a["headers"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["query"] == "12 Tràng Tiền"
    assert body["geocoder_disabled"] is False
    assert [s["display_name"] for s in body["suggestions"]] == ["12 Tràng Tiền 0, Việt Nam", "12 Tràng Tiền 1, Việt Nam"]
    assert seen_queries == ["12 Tràng Tiền"]


@pytest.mark.asyncio
async def test_post_sends_nothing_when_addresses_may_not_leave(
    http_client, tenant_a, seen_queries, monkeypatch
):
    monkeypatch.setenv("OE_GEOCODER_DISABLED", "true")
    res = await http_client.post(URL, json={"q": "12 Tràng Tiền"}, headers=tenant_a["headers"])
    assert res.status_code == 200, res.text
    assert res.json()["geocoder_disabled"] is True
    assert res.json()["suggestions"] == []
    assert seen_queries == []


@pytest.mark.asyncio
async def test_post_validates_the_body(http_client, tenant_a, seen_queries):
    assert (await http_client.post(URL, json={"q": ""}, headers=tenant_a["headers"])).status_code == 422
    assert (await http_client.post(URL, json={"q": "Hà Nội", "limit": 11}, headers=tenant_a["headers"])).status_code == 422
    assert (await http_client.post(URL, json={}, headers=tenant_a["headers"])).status_code == 422
    assert seen_queries == []


@pytest.mark.asyncio
async def test_post_requires_auth(http_client, seen_queries):
    res = await http_client.post(URL, json={"q": "Hà Nội"})
    assert res.status_code in (401, 403)
    assert seen_queries == []
