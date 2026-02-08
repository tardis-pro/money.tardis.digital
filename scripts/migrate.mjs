#!/usr/bin/env tsx

import { PostgresStore } from "../src/store-postgres.js";

async function migrate() {
  console.log("Starting database migration...");

  try {
    const store = new PostgresStore();
    console.log("PostgresStore created");

    await store.init();
    console.log("✓ Database initialized successfully");

    // Verify users were created
    const state = await store.read();
    console.log(`✓ Found ${state.userProfiles.length} users:`);
    for (const user of state.userProfiles) {
      console.log(`  - ${user.id} (${user.displayName}) - ${user.role}`);
    }

    process.exit(0);
  } catch (error) {
    console.error("✗ Migration failed:", error);
    process.exit(1);
  }
}

migrate();
