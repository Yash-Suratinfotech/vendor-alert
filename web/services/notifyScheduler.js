// web/services/notifyScheduler.js
import dotenv from "dotenv";
dotenv.config();
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import db from "../db.js";
import fetch from "node-fetch";

function getCurrentTime() {
  const now = new Date();
  const hour = now.getHours();
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12} ${ampm}`;
}

export async function runNotifyScheduler() {
  try {
    const now = new Date();
    const currentTime = getCurrentTime();
    const currentHour = now.getHours();

    const result = await db.query(`
      SELECT id, shop_domain, notify_mode, notify_value 
      FROM users 
      WHERE user_type = 'store_owner'
        AND notify_mode IS NOT NULL 
        AND notify_value IS NOT NULL
    `);

    const shopOwners = result.rows;

    for (const { shop_domain, notify_mode, notify_value } of shopOwners) {
      console.log("✌️notify_value --->", notify_value);
      console.log("✌️currentTime --->", currentTime);
      if (notify_mode === "specific_time") {
        if (notify_value === currentTime) {
          await triggerNotification(shop_domain);
        }
      }

      if (notify_mode === "every_x_hours") {
        const interval = parseInt(notify_value);
        if (interval && currentHour % interval === 0) {
          await triggerNotification(shop_domain);
        }
      }
    }
  } catch (err) {
    console.error("❌ notifyScheduler error:", err);
  }
}

async function triggerNotification(shopDomain) {
  try {
    const response = await fetch(
      `${process.env.BACKEND_URL}/api/notify-orders`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopDomain }),
      }
    );

    const result = await response.json();

    if (response.ok) {
      console.log(`✅ Notification sent to ${shopDomain}`);
    } else {
      console.error(`❌ Failed to notify ${shopDomain}:`, result.error);
    }
  } catch (error) {
    console.error(`❌ Error for ${shopDomain}:`, error.message);
  }
}
