// web/db-table.js - updated
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
    -- 🏪 Users Table - For Shop owner and vendor
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50),
      email VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255),
      access_token TEXT,
      phone VARCHAR(15),
      avatar_url TEXT,
      color VARCHAR(100),
      shop_domain VARCHAR(50) UNIQUE, -- Only for store_owner type
      user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('vendor', 'store_owner')),
      notify_mode VARCHAR(20) CHECK (notify_mode IN ('every_x_hours', 'specific_time')),
      notify_value VARCHAR(10)',
      initial_sync_completed BOOLEAN DEFAULT FALSE,
      otp VARCHAR(6),
      otp_expires_at TIMESTAMP,
      reset_token VARCHAR(255),
      reset_token_expires_at TIMESTAMP,
      last_login TIMESTAMP,
      login_attempts INT DEFAULT 0,
      locked_until TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_notified_at TIMESTAMP DEFAULT NULL,
      last_active TIMESTAMP DEFAULT NOW(),
      is_active BOOLEAN DEFAULT true,
      is_verified BOOLEAN DEFAULT false,
      -- Ensure proper user associations
      CONSTRAINT user_association_check CHECK (
        (user_type = 'store_owner' AND shop_domain IS NOT NULL) OR
        (user_type = 'vendor')
      )
    );

    -- 🏢 Vendors Table (simplified - only order-based vendors)
    CREATE TABLE vendors (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      contact_person VARCHAR(255),
      mobile VARCHAR(15),
      email VARCHAR(255),
      upi_id VARCHAR(100),
      shop_domain VARCHAR(50) NOT NULL REFERENCES users(shop_domain) ON DELETE CASCADE,
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
      shop_domain VARCHAR(50) NOT NULL REFERENCES users(shop_domain) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 📬 Orders Table (simplified - only essential order data)
    CREATE TABLE orders (
      id SERIAL PRIMARY KEY,
      shopify_order_id BIGINT UNIQUE NOT NULL,
      name VARCHAR(50) NOT NULL,
      notification BOOLEAN DEFAULT FALSE,
      shop_domain VARCHAR(50) NOT NULL REFERENCES users(shop_domain) ON DELETE CASCADE,
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
      notification BOOLEAN DEFAULT FALSE,
      shop_domain VARCHAR(50) NOT NULL REFERENCES users(shop_domain) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 📊 Sync Log Table (for tracking sync operations)
    CREATE TABLE sync_logs (
      id SERIAL PRIMARY KEY,
      shop_domain VARCHAR(50) NOT NULL,
      sync_type VARCHAR(50) NOT NULL, -- 'initial', 'webhook', 'manual'
      entity_type VARCHAR(50) NOT NULL, -- 'orders_and_products', 'orders', 'products'
      status VARCHAR(50) NOT NULL, -- 'running', 'success', 'error'
      records_processed INT DEFAULT 0,
      error_message TEXT,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    );

    -- 💬 Messages Table - Direct messaging between users
    CREATE TABLE messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'file', 'order_notification')),
      file_url VARCHAR(500) DEFAULT NULL,
      file_name VARCHAR(255) DEFAULT NULL,
      order_data JSONB DEFAULT NULL, -- For order notification data
      parent_message_id INTEGER REFERENCES messages(id),
      created_at TIMESTAMP DEFAULT NOW(),
      is_deleted BOOLEAN DEFAULT false
    );

    -- 📩 Message Recipients Table - Track delivery and acceptance
    CREATE TABLE message_recipients (
      id SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      is_accept BOOLEAN DEFAULT NULL, -- For order_notification messages: true=accept, false=decline, null=pending
      delivery_status VARCHAR(20) DEFAULT 'sent' CHECK (delivery_status IN ('sent', 'delivered', 'read', 'failed')),
      sent_at TIMESTAMP DEFAULT NOW(),
      delivered_at TIMESTAMP,
      read_at TIMESTAMP,
      is_read BOOLEAN DEFAULT false,
      UNIQUE(message_id)
    );
  `);

  console.log("✅ All VendorAlert tables created successfully");
} catch (error) {
  console.error("❌ Error setting up VendorAlert database:", error);
  throw error;
} finally {
  await client.end();
}
