#!/usr/bin/env node
/**
 * Seed sample strategies — safe to re-run (idempotent)
 * Usage: node scripts/seed-strategies.mjs [--base-url http://localhost:3000]
 */

const BASE_URL = process.argv.find(a => a.startsWith('--base-url='))?.split('=')[1] 
  ?? process.env.API_BASE_URL 
  ?? 'http://localhost:3000';

const SAMPLE_STRATEGIES = [
  { templateId: 'trend-following', name: 'Nifty Trend Following — SMA/EMA Crossover', sector: 'broad-market', tags: ['trend', 'momentum', 'nifty50'] },
  { templateId: 'mean-reversion', name: 'Banking Sector Mean Reversion — RSI + Bollinger', sector: 'bfsi', tags: ['mean-reversion', 'rsi', 'banking'] },
  { templateId: 'breakout', name: 'Infra Breakout — Volume Confirmed', sector: 'infra', tags: ['breakout', 'volume', 'infra'] },
  { templateId: 'momentum', name: 'IT Sector Momentum — RSI + MACD Alignment', sector: 'it', tags: ['momentum', 'it', 'macd'] },
  { templateId: 'pairs-trading', name: 'PSU Bank Pairs — SBIN/PNB Spread', sector: 'bfsi', tags: ['pairs', 'psu-bank', 'spread'] },
  { templateId: 'sector-rotation', name: 'Nifty Sector Rotation — Top 3 Monthly', sector: 'broad-market', tags: ['rotation', 'sector', 'monthly'] },
  { templateId: 'mean-reversion-volatility', name: 'Pharma Mean Reversion Low Volatility', sector: 'pharma', tags: ['pharma', 'mean-reversion', 'volatility'] },
  { templateId: 'breakout-volume-confirmation', name: 'Defense Breakout + Volume Surge', sector: 'defense', tags: ['defense', 'breakout', 'volume'] },
  { templateId: 'multi-timeframe-momentum', name: 'Multi-Timeframe Momentum — Large Cap', sector: 'broad-market', tags: ['multi-timeframe', 'large-cap', 'momentum'] },
];

async function main() {
  console.log(`Seeding strategies at ${BASE_URL}`);
  
  // Check if strategy-ai is available
  const templatesRes = await fetch(`${BASE_URL}/api/templates`);
  if (!templatesRes.ok) {
    console.error(`Templates endpoint returned ${templatesRes.status}. Is the server running?`);
    process.exit(1);
  }
  const { templates } = await templatesRes.json();
  const availableTemplateIds = new Set(templates.map(t => t.id));
  console.log(`Found ${templates.length} templates: ${[...availableTemplateIds].join(', ')}`);
  
  // Get existing strategies for idempotency
  const existing = await fetch(`${BASE_URL}/api/strategies`).then(r => r.ok ? r.json() : { strategies: [] });
  const existingNames = new Set((existing.strategies ?? []).map(s => s.name));
  
  let created = 0, skipped = 0, failed = 0;
  
  for (const sample of SAMPLE_STRATEGIES) {
    if (existingNames.has(sample.name)) {
      console.log(`  skip: "${sample.name}" (already exists)`);
      skipped++;
      continue;
    }
    if (!availableTemplateIds.has(sample.templateId)) {
      console.log(`  skip: template "${sample.templateId}" not available`);
      skipped++;
      continue;
    }
    const body = {
      prompt: `Create a ${sample.name} strategy`,
      templateId: sample.templateId,
      sector: sample.sector,
      tags: sample.tags,
      name: sample.name,
    };
    const res = await fetch(`${BASE_URL}/api/strategies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'demo-analyst' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`  created: "${sample.name}" → id=${data.strategy?.id ?? data.id ?? '?'}`);
      created++;
    } else {
      const err = await res.text();
      console.log(`  failed: "${sample.name}" — ${res.status} ${err.slice(0, 120)}`);
      failed++;
    }
  }
  
  console.log(`\nDone: ${created} created, ${skipped} skipped, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
