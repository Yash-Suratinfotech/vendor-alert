// web/db-table.js
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { Client } from "pg";
const DATABASE_URL = process.env.DATABASE_URL;
console.log("🔗 DATABASE_URL:", DATABASE_URL ? "Connected" : "Not found");

const client = new Client({
  connectionString: DATABASE_URL,
});

await client.connect();

try {
  // Create simplified tables for order-based products only
  await client.query(`
    -- 🏪 Shops Table
    CREATE TABLE shops (
      id SERIAL PRIMARY KEY,
      shop_domain TEXT UNIQUE NOT NULL,
      access_token TEXT,
      shopify_shop_id BIGINT,
      initial_sync_completed BOOLEAN DEFAULT FALSE,
      installed_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- 🏢 Vendors Table (simplified - only order-based vendors)
    CREATE TABLE vendors (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      contact_person VARCHAR(255),
      mobile VARCHAR(15),
      email VARCHAR(255),
      upi_id VARCHAR(100),
      shop_domain TEXT NOT NULL REFERENCES shops(shop_domain) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name, shop_domain)
    );

    -- 📦 Products Table (only products that appear in orders - NO DUPLICATES)
    CREATE TABLE products (
      id SERIAL PRIMARY KEY,
      shopify_product_id BIGINT UNIQUE NOT NULL,
      title VARCHAR(255) NOT NULL,
      image TEXT,
      vendor_name VARCHAR(255),
      vendor_id INT REFERENCES vendors(id) ON DELETE SET NULL,
      shop_domain TEXT NOT NULL REFERENCES shops(shop_domain) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 📬 Orders Table (simplified - only essential order data)
    CREATE TABLE orders (
      id SERIAL PRIMARY KEY,
      shopify_order_id BIGINT UNIQUE NOT NULL,
      name VARCHAR(50) NOT NULL,
      notification BOOLEAN DEFAULT FALSE,
      shop_domain TEXT NOT NULL REFERENCES shops(shop_domain) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      shopify_created_at TIMESTAMP,
      shopify_updated_at TIMESTAMP
    );

    -- 📋 Order Line Items Table (simplified - only essential line item data)
    CREATE TABLE order_line_items (
      id SERIAL PRIMARY KEY,
      order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INT NOT NULL,
      shop_domain TEXT NOT NULL REFERENCES shops(shop_domain) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 📊 Sync Log Table (for tracking sync operations)
    CREATE TABLE sync_logs (
      id SERIAL PRIMARY KEY,
      shop_domain TEXT NOT NULL,
      sync_type VARCHAR(50) NOT NULL, -- 'initial', 'webhook', 'manual'
      entity_type VARCHAR(50) NOT NULL, -- 'orders_and_products', 'orders', 'products'
      status VARCHAR(50) NOT NULL, -- 'running', 'success', 'error'
      records_processed INT DEFAULT 0,
      error_message TEXT,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    );
  `);

  console.log(
    "✅ All VendorAlert tables created successfully"
  );
} catch (error) {
  console.error("❌ Error setting up VendorAlert database:", error);
  throw error;
} finally {
  await client.end();
}
