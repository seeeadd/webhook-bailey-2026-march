/**
 * One-Click Registration
 *
 * For warm traffic (people already on the email list).
 * Email button links here with email + name in URL params.
 * Registers them in FEA Create + Google Sheet, then redirects to VIP upsell.
 *
 * Usage in email:
 * https://webhook-bailey-2026-march.vercel.app/api/one-click-register?email={{contact.email}}&name={{contact.first_name}}
 */

const FEA_CREATE_WEBHOOK = 'https://services.leadconnectorhq.com/hooks/mRbOcEobWT5kQ5hBurus/webhook-trigger/PEdORYZKKEX2l3dFp3Av';
const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycby7NHBuIDWJfZ4w_hkQ1fEs022sN8xInRKeNgorIdDCVIdtX7om1v7fU0yW3fj2nOzPvg/exec';
const REDIRECT_URL = 'https://baileymasterclass.com/vip/';

module.exports = async function handler(req, res) {
  // Handle both GET (email link click) and POST
  const params = req.method === 'GET' ? req.query : req.body;

  const email = params.email || '';
  const name = params.name || params.first_name || '';

  if (!email) {
    // No email = redirect anyway, don't break the experience
    console.log('[One-Click] No email provided, redirecting anyway');
    res.writeHead(302, { Location: REDIRECT_URL });
    return res.end();
  }

  console.log(`[One-Click] Registering: ${email}, Name: ${name}`);

  // Fire both requests in parallel, don't wait for them to finish
  // The user gets redirected immediately
  const feaPromise = fetch(FEA_CREATE_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email,
      first_name: name,
      source: 'one-click-email'
    })
  }).catch(err => console.error(`[One-Click] FEA Create error: ${err.message}`));

  const sheetParams = new URLSearchParams({
    email: email,
    name: name,
    source: 'one-click-email'
  });
  const sheetPromise = fetch(GOOGLE_SHEET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: sheetParams.toString()
  }).catch(err => console.error(`[One-Click] Google Sheet error: ${err.message}`));

  // Wait for both to fire (but don't block redirect on failure)
  try {
    await Promise.allSettled([feaPromise, sheetPromise]);
    console.log(`[One-Click] Both requests sent for ${email}`);
  } catch (err) {
    console.error(`[One-Click] Error: ${err.message}`);
  }

  // Redirect to VIP upsell page
  res.writeHead(302, { Location: REDIRECT_URL });
  return res.end();
}
