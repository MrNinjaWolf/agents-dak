import unittest
from decimal import Decimal

from inventory import Inventory, OutOfStock


class InventoryTest(unittest.TestCase):
    def test_add_and_value(self):
        inv = Inventory()
        inv.add("A1", "Widget", "2.50", stock=4, tags=["tools"])
        inv.add("B2", "Gadget", "10.00", stock=1, tags=["tools"])
        self.assertEqual(inv.total_value(), Decimal("20.00"))

    def test_reserve_and_release(self):
        inv = Inventory()
        inv.add("A1", "Widget", "2.50", stock=10, tags=[])
        inv.reserve("A1", 3)
        self.assertEqual(inv.available("A1"), 7)
        inv.release("A1", 5)
        self.assertEqual(inv.available("A1"), 10)

    def test_reserve_too_many(self):
        inv = Inventory()
        inv.add("A1", "Widget", "2.50", stock=2, tags=[])
        with self.assertRaises(OutOfStock):
            inv.reserve("A1", 5)


if __name__ == "__main__":
    unittest.main()
