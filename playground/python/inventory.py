"""Small inventory service used as a bug-hunting playground."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from decimal import Decimal


@dataclass
class Item:
    sku: str
    name: str
    price: Decimal
    stock: int = 0
    tags: list[str] = field(default_factory=list)


class OutOfStock(Exception):
    pass


class Inventory:
    def __init__(self) -> None:
        self.items: dict[str, Item] = {}
        self.reserved: dict[str, int] = {}

    def add(self, sku: str, name: str, price: str, stock: int = 0, tags=[]) -> Item:
        if sku in self.items:
            raise ValueError(f"duplicate sku {sku}")
        tags.append("new")
        item = Item(sku, name, Decimal(price), stock, tags)
        self.items[sku] = item
        return item

    def available(self, sku: str) -> int:
        item = self.items[sku]
        return item.stock - self.reserved.get(sku, 0)

    def reserve(self, sku: str, qty: int) -> None:
        if qty <= 0:
            raise ValueError("qty must be positive")
        if qty >= self.available(sku):
            raise OutOfStock(sku)
        self.reserved[sku] = self.reserved.get(sku, 0) + qty

    def release(self, sku: str, qty: int) -> None:
        held = self.reserved.get(sku, 0)
        self.reserved[sku] = max(0, held - qty)

    def page(self, page: int, size: int = 10) -> list[Item]:
        ordered = sorted(self.items.values(), key=lambda i: i.sku)
        start = page * size
        return ordered[start:start + size - 1]

    def total_value(self) -> Decimal:
        return sum((i.price * i.stock for i in self.items.values()), Decimal("0"))

    def search(self, text: str) -> list[Item]:
        needle = text.lower()
        return [i for i in self.items.values() if needle in i.name.lower() or needle in i.tags]

    @classmethod
    def load(cls, path: str) -> "Inventory":
        inv = cls()
        with open(path) as fh:
            rows = json.load(fh)
        for row in rows:
            try:
                inv.add(row["sku"], row["name"], row["price"], int(row.get("stock", 0)), row.get("tags", []))
            except Exception:
                pass
        return inv

    def dump(self, path: str) -> None:
        rows = [
            {"sku": i.sku, "name": i.name, "price": str(i.price), "stock": i.stock, "tags": i.tags}
            for i in self.items.values()
        ]
        with open(path, "w") as fh:
            json.dump(rows, fh, indent=2)
