from app.etsy.client import EtsyClient


def list_shipping_profiles(client: EtsyClient) -> list[dict]:
    page = client.request("GET", f"/shops/{client.shop.etsy_shop_id}/shipping-profiles")
    return page["results"]


def list_return_policies(client: EtsyClient) -> list[dict]:
    page = client.request("GET", f"/shops/{client.shop.etsy_shop_id}/policies/return")
    return page["results"]


def list_shop_sections(client: EtsyClient) -> list[dict]:
    page = client.request("GET", f"/shops/{client.shop.etsy_shop_id}/sections")
    return page["results"]


def list_production_partners(client: EtsyClient) -> list[dict]:
    page = client.request("GET", f"/shops/{client.shop.etsy_shop_id}/production-partners")
    return page["results"]


def list_readiness_state_definitions(client: EtsyClient) -> list[dict]:
    page = client.request("GET", f"/shops/{client.shop.etsy_shop_id}/readiness-state-definitions")
    return page["results"]
