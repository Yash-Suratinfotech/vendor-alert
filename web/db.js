// web/db.js
import dotenv from "dotenv";
dotenv.config();
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import pkg from "pg";
const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: DATABASE_URL,
});

export default {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
};
