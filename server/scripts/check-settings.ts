import { db } from '../db';
import { settings } from '@shared/schema';
import { inArray } from 'drizzle-orm';

async function run() {
  try {
    const result = await db.select().from(settings).where(inArray(settings.key, ['ve_tts_sarvam_model', 've_tts_sarvam_speaker']));
    console.log("Settings:");
    result.forEach(row => {
      console.log(`${row.key}: ${row.value}`);
    });
  } catch (error) {
    console.error("Database query failed:", error);
  }
  process.exit(0);
}

run();
