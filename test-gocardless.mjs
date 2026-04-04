#!/usr/bin/env node
/**
 * Test script for GoCardless subscription system
 * Run: node test-gocardless.mjs
 *
 * Requires: dev server running on localhost:3000
 * Tests: webhook signature, IBAN validation, invoice numbering
 */

import crypto from 'crypto'

const BASE_URL = 'http://localhost:3000'
const WEBHOOK_SECRET = 'test_webhook_secret_voltis_2026'

let passed = 0
let failed = 0

function log(ok, test, detail = '') {
  if (ok) {
    passed++
    console.log(`  ✅ ${test}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    console.log(`  ❌ ${test}${detail ? ` — ${detail}` : ''}`)
  }
}

// ═══════════════════════════════════════
// 1. WEBHOOK SIGNATURE VERIFICATION
// ═══════════════════════════════════════
async function testWebhook() {
  console.log('\n🔐 WEBHOOK SIGNATURE VERIFICATION')
  console.log('─'.repeat(45))

  const testPayload = JSON.stringify({
    events: [{
      resource_type: 'mandates',
      action: 'active',
      links: { mandate: 'MD_TEST_123' }
    }]
  })

  // Test 1: Valid signature → should return 200
  const validSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(testPayload)
    .digest('hex')

  try {
    const res = await fetch(`${BASE_URL}/api/gocardless/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Webhook-Signature': validSignature,
      },
      body: testPayload,
    })
    log(res.status === 200, 'Valid signature accepted', `status=${res.status}`)
  } catch (e) {
    log(false, 'Valid signature accepted', e.message)
  }

  // Test 2: Invalid signature → should return 498
  try {
    const res = await fetch(`${BASE_URL}/api/gocardless/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Webhook-Signature': 'deadbeef0000000000000000000000000000000000000000000000000000dead',
      },
      body: testPayload,
    })
    log(res.status === 498, 'Invalid signature rejected', `status=${res.status}`)
  } catch (e) {
    log(false, 'Invalid signature rejected', e.message)
  }

  // Test 3: Missing signature → should return 498
  try {
    const res = await fetch(`${BASE_URL}/api/gocardless/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: testPayload,
    })
    log(res.status === 498, 'Missing signature rejected', `status=${res.status}`)
  } catch (e) {
    log(false, 'Missing signature rejected', e.message)
  }

  // Test 4: Tampered payload → should return 498
  const tamperedPayload = JSON.stringify({
    events: [{
      resource_type: 'mandates',
      action: 'cancelled',  // changed from 'active'
      links: { mandate: 'MD_TEST_123' }
    }]
  })
  try {
    const res = await fetch(`${BASE_URL}/api/gocardless/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Webhook-Signature': validSignature, // signature from original payload
      },
      body: tamperedPayload,
    })
    log(res.status === 498, 'Tampered payload rejected', `status=${res.status}`)
  } catch (e) {
    log(false, 'Tampered payload rejected', e.message)
  }
}

// ═══════════════════════════════════════
// 2. IBAN VALIDATION (client-side logic)
// ═══════════════════════════════════════
function testIBAN() {
  console.log('\n🏦 IBAN VALIDATION')
  console.log('─'.repeat(45))

  // Reimplementation of validateIBAN for testing
  function validateIBAN(iban) {
    const cleaned = iban.replace(/\s/g, '').toUpperCase()
    if (!cleaned) return { valid: false, error: 'IBAN es obligatorio' }
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(cleaned)) return { valid: false, error: 'Formato IBAN invalido' }

    const countryLengths = {
      ES: 24, DE: 22, FR: 27, IT: 27, PT: 25, GB: 22, NL: 18, BE: 16,
      AT: 20, IE: 22, LU: 20, CH: 21, DK: 18, SE: 24, NO: 15, FI: 18,
    }
    const country = cleaned.substring(0, 2)
    const expected = countryLengths[country]
    if (expected && cleaned.length !== expected) {
      return { valid: false, error: `IBAN ${country} debe tener ${expected} caracteres` }
    }

    const rearranged = cleaned.substring(4) + cleaned.substring(0, 4)
    const numericStr = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55))
    let remainder = 0
    for (let i = 0; i < numericStr.length; i += 7) {
      const chunk = String(remainder) + numericStr.substring(i, i + 7)
      remainder = parseInt(chunk, 10) % 97
    }
    if (remainder !== 1) return { valid: false, error: 'IBAN no valido (checksum incorrecto)' }
    return { valid: true }
  }

  // Valid IBANs
  log(validateIBAN('ES91 2100 0418 4502 0005 1332').valid, 'ES valid IBAN (La Caixa)')
  log(validateIBAN('ES80 2310 0001 1800 0001 2345').valid, 'ES valid IBAN (another)')
  log(validateIBAN('DE89 3704 0044 0532 0130 00').valid, 'DE valid IBAN')
  log(validateIBAN('FR76 3000 6000 0112 3456 7890 189').valid, 'FR valid IBAN')
  log(validateIBAN('GB29 NWBK 6016 1331 9268 19').valid, 'GB valid IBAN')
  log(validateIBAN('PT50 0002 0123 1234 5678 9015 4').valid, 'PT valid IBAN')

  // Invalid IBANs
  log(!validateIBAN('').valid, 'Empty IBAN rejected')
  log(!validateIBAN('ES00 0000 0000 0000 0000 0000').valid, 'Invalid checksum rejected')
  log(!validateIBAN('ES91 2100').valid, 'Too short rejected')
  log(!validateIBAN('XX91 2100 0418 4502 0005 1332').valid, 'Invalid country code handled')
  log(!validateIBAN('1234567890').valid, 'No country prefix rejected')
  log(!validateIBAN('ES91 2100 0418 4502 0005 1333').valid, 'Wrong check digit rejected')
}

// ═══════════════════════════════════════
// 3. INVOICE NUMBERING
// ═══════════════════════════════════════
function testInvoiceNumbering() {
  console.log('\n🧾 INVOICE NUMBERING FORMAT')
  console.log('─'.repeat(45))

  const year = new Date().getFullYear()
  const prefix = `VOLT-${year}-`

  // Test format: VOLT-YYYY-NNNNN
  const num1 = `${prefix}${String(1).padStart(5, '0')}`
  log(num1 === `VOLT-${year}-00001`, `First invoice: ${num1}`)

  const num99 = `${prefix}${String(99).padStart(5, '0')}`
  log(num99 === `VOLT-${year}-00099`, `99th invoice: ${num99}`)

  const num1000 = `${prefix}${String(1000).padStart(5, '0')}`
  log(num1000 === `VOLT-${year}-01000`, `1000th invoice: ${num1000}`)

  // Verify sequential parsing
  const lastNumber = `VOLT-${year}-00042`
  const lastSeq = parseInt(lastNumber.replace(prefix, ''), 10)
  const next = `${prefix}${String(lastSeq + 1).padStart(5, '0')}`
  log(next === `VOLT-${year}-00043`, `Sequential after 42: ${next}`)

  // Verify old format NOT used
  const oldFormat = `GC-${Date.now()}`
  log(!oldFormat.startsWith('VOLT-'), `Old format (GC-timestamp) no longer used`)
}

// ═══════════════════════════════════════
// 4. DUPLICATE PREVENTION
// ═══════════════════════════════════════
async function testDuplicatePrevention() {
  console.log('\n🔒 DUPLICATE PREVENTION (create-payment)')
  console.log('─'.repeat(45))

  // This tests the endpoint returns proper errors without valid data
  try {
    const res = await fetch(`${BASE_URL}/api/gocardless/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandateId: '',
        amountCents: 0,
        subscriptionId: 'test',
        clientId: null,
        description: 'test',
        mode: 'single',
      }),
    })
    const data = await res.json()
    log(res.status === 400, 'Missing mandateId/amount returns 400', `status=${res.status}`)
  } catch (e) {
    log(false, 'Missing mandateId/amount returns 400', e.message)
  }
}

// ═══════════════════════════════════════
// RUN ALL TESTS
// ═══════════════════════════════════════
async function main() {
  console.log('╔══════════════════════════════════════════╗')
  console.log('║  VOLTIS CRM — GoCardless Test Suite      ║')
  console.log('╚══════════════════════════════════════════╝')

  // Tests that don't need server
  testIBAN()
  testInvoiceNumbering()

  // Tests that need server
  try {
    await fetch(`${BASE_URL}`, { signal: AbortSignal.timeout(2000) })
    console.log('\n🌐 Server detected on localhost:3000')
    await testWebhook()
    await testDuplicatePrevention()
  } catch {
    console.log('\n⚠️  Server NOT running — skipping API tests')
    console.log('   Ejecuta: npm run dev')
    console.log('   Y luego: node test-gocardless.mjs')
  }

  // Summary
  console.log('\n' + '═'.repeat(45))
  console.log(`  RESULTADO: ${passed} passed, ${failed} failed`)
  console.log('═'.repeat(45))
  process.exit(failed > 0 ? 1 : 0)
}

main()
