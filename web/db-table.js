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
  // Create all tables for VendorAlert system
  await client.query(`
    -- 🏪 Shops Table
    CREATE TABLE IF NOT EXISTS shops (
      id SERIAL PRIMARY KEY,
      shop_domain TEXT UNIQUE NOT NULL,
      access_token TEXT,
      shopify_shop_id BIGINT,
      initial_sync_completed BOOLEAN DEFAULT FALSE,
      installed_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- 🏢 Vendors Table (Enhanced for Shopify data)
    CREATE TABLE IF NOT EXISTS vendors (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      shopify_vendor_name VARCHAR(255),
      contact_person VARCHAR(255),
      mobile VARCHAR(15),
      email VARCHAR(255),
      upi_id VARCHAR(100),
      shop_domain TEXT NOT NULL REFERENCES shops(shop_domain) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(shopify_vendor_name, shop_domain)
    );

    -- 📦 Products Table (Enhanced for Shopify sync)
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      shopify_product_id BIGINT UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      sku VARCHAR(100),
      vendor_name VARCHAR(255),
      vendor_id INT REFERENCES vendors(id) ON DELETE SET NULL,
      handle VARCHAR(255),
      product_type VARCHAR(255),
      status VARCHAR(50) DEFAULT 'active',
      inventory_quantity INT DEFAULT 0,
      price DECIMAL(10,2),
      shop_domain TEXT NOT NULL REFERENCES shops(shop_domain) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      shopify_created_at TIMESTAMP,
      shopify_updated_at TIMESTAMP
    );

    -- 📬 Orders Table (Only business data)
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      shopify_order_id BIGINT UNIQUE NOT NULL,
      shopify_order_number VARCHAR(50),
      total_price DECIMAL(10,2),
      financial_status VARCHAR(50),
      fulfillment_status VARCHAR(50),
      order_status VARCHAR(50) DEFAULT 'pending',
      notified BOOLEAN DEFAULT FALSE,
      shop_domain TEXT NOT NULL REFERENCES shops(shop_domain) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      shopify_created_at TIMESTAMP,
      shopify_updated_at TIMESTAMP
    );

    -- 📋 Order Line Items Table (Only product and vendor data)
    CREATE TABLE IF NOT EXISTS order_line_items (
      id SERIAL PRIMARY KEY,
      order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      shopify_line_item_id BIGINT,
      product_id INT REFERENCES products(id) ON DELETE SET NULL,
      shopify_product_id BIGINT,
      shopify_variant_id BIGINT,
      title VARCHAR(255),
      vendor VARCHAR(255),
      quantity INT NOT NULL,
      price DECIMAL(10,2),
      total_discount DECIMAL(10,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 📊 Sync Log Table (Track sync operations)
    CREATE TABLE IF NOT EXISTS sync_logs (
      id SERIAL PRIMARY KEY,
      shop_domain TEXT NOT NULL,
      sync_type VARCHAR(50) NOT NULL, -- 'initial', 'webhook', 'manual'
      entity_type VARCHAR(50) NOT NULL, -- 'products', 'orders', 'vendors'
      status VARCHAR(50) NOT NULL, -- 'success', 'error', 'partial'
      records_processed INT DEFAULT 0,
      error_message TEXT,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    );

    -- Create indexes for better performance
    CREATE INDEX IF NOT EXISTS idx_products_shopify_id ON products(shopify_product_id);
    CREATE INDEX IF NOT EXISTS idx_products_shop_domain ON products(shop_domain);
    CREATE INDEX IF NOT EXISTS idx_products_vendor_name ON products(vendor_name);
    
    CREATE INDEX IF NOT EXISTS idx_orders_shopify_id ON orders(shopify_order_id);
    CREATE INDEX IF NOT EXISTS idx_orders_shop_domain ON orders(shop_domain);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(financial_status, fulfillment_status);
    
    CREATE INDEX IF NOT EXISTS idx_vendors_shop_domain ON vendors(shop_domain);
    CREATE INDEX IF NOT EXISTS idx_vendors_shopify_name ON vendors(shopify_vendor_name);
    
    CREATE INDEX IF NOT EXISTS idx_sync_logs_shop_type ON sync_logs(shop_domain, entity_type);
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
