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
  // Create table
  await client.query(`
    -- 1. shops table
    CREATE TABLE IF NOT EXISTS shops (
      id SERIAL PRIMARY KEY,
      shop_domain TEXT UNIQUE NOT NULL,
      access_token TEXT,
      installed_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log("✅ All tables created successfully");
} catch (error) {
  console.error("❌ Error setting up enhanced database:", error);
  throw error;
} finally {
  await client.end();
}