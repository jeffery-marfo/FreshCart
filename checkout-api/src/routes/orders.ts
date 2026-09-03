import { Router } from "express";
import { pool } from "../db";

export const ordersRouter = Router();

type OrderItemInput = {
  productId: number;
  quantity: number;
};

function isValidItems(items: unknown): items is OrderItemInput[] {
  return (
    Array.isArray(items) &&
    items.length > 0 &&
    items.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        Number.isInteger((item as OrderItemInput).productId) &&
        Number.isInteger((item as OrderItemInput).quantity) &&
        (item as OrderItemInput).quantity > 0
    )
  );
}

ordersRouter.post("/api/orders", async (req, res) => {
  const { customerName, customerEmail, items } = req.body ?? {};

  if (typeof customerName !== "string" || customerName.trim() === "") {
    res.status(400).json({ error: "customerName is required." });
    return;
  }
  if (typeof customerEmail !== "string" || customerEmail.trim() === "") {
    res.status(400).json({ error: "customerEmail is required." });
    return;
  }
  if (!isValidItems(items)) {
    res.status(400).json({ error: "items must be a non-empty array of { productId, quantity }." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("begin");

    const productIds = items.map((item) => item.productId);
    const productRows = await client.query(
      "select id, price_cents, stock from products where id = any($1::int[])",
      [productIds]
    );

    const priceByProduct = new Map(productRows.rows.map((row) => [row.id as number, row]));

    for (const item of items) {
      const product = priceByProduct.get(item.productId);
      if (!product) {
        throw new Error(`Product ${item.productId} does not exist.`);
      }
      if (product.stock < item.quantity) {
        throw new Error(`Not enough stock for product ${item.productId}.`);
      }
    }

    const orderResult = await client.query(
      "insert into orders (customer_name, customer_email) values ($1, $2) returning id, status, created_at",
      [customerName.trim(), customerEmail.trim()]
    );
    const order = orderResult.rows[0];

    for (const item of items) {
      const product = priceByProduct.get(item.productId)!;
      await client.query(
        "insert into order_items (order_id, product_id, quantity, unit_price_cents) values ($1, $2, $3, $4)",
        [order.id, item.productId, item.quantity, product.price_cents]
      );
    }

    await client.query("commit");
    res.status(201).json({ order });
  } catch (error) {
    await client.query("rollback");
    res.status(400).json({ error: (error as Error).message });
  } finally {
    client.release();
  }
});

ordersRouter.get("/api/orders/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Order id must be an integer." });
    return;
  }

  try {
    const orderResult = await pool.query(
      "select id, customer_name, customer_email, status, created_at from orders where id = $1",
      [id]
    );

    if (orderResult.rows.length === 0) {
      res.status(404).json({ error: "Order not found." });
      return;
    }

    const itemsResult = await pool.query(
      `select oi.product_id, p.name, oi.quantity, oi.unit_price_cents
       from order_items oi join products p on p.id = oi.product_id
       where oi.order_id = $1`,
      [id]
    );

    res.json({ order: orderResult.rows[0], items: itemsResult.rows });
  } catch (error) {
    res.status(500).json({ error: "Could not load order.", detail: (error as Error).message });
  }
});
