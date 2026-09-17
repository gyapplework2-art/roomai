"""Future pricing boundary; vendor facts remain separate from RoomAI pricing."""

from crawler.models.product import CurrentOffer


def vendor_offer_snapshot(offer: CurrentOffer | None) -> CurrentOffer | None:
    """Return vendor commercial facts unchanged; no RoomAI pricing is calculated."""
    return offer
