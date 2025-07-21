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
      installed_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- 🏢 Vendors Table
    CREATE TABLE IF NOT EXISTS vendors (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      contact_person VARCHAR(255),
      mobile VARCHAR(15),
      email VARCHAR(255),
      upi_id VARCHAR(100),
      shop_domain TEXT NOT NULL REFERENCES shops(shop_domain) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 📦 Products Table
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      sku VARCHAR(100) UNIQUE NOT NULL,
      vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
      shop_domain TEXT NOT NULL REFERENCES shops(shop_domain) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 📬 Orders Table
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INT NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      order_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      notified BOOLEAN DEFAULT FALSE,
      shop_domain TEXT NOT NULL REFERENCES shops(shop_domain) ON DELETE CASCADE
    );
  `);

  console.log("✅ All VendorAlert tables created successfully");
} catch (error) {
  console.error("❌ Error setting up VendorAlert database:", error);
  throw error;
} finally {
  await client.end();
}
